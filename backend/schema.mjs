// 全部 DDL 都在这个文件里：一张表一段，按版本（= git tag）分组。
//
// 为什么集中：以前 DDL 散在 db.mjs / forum/index.mjs / forum/dm.mjs / avatar/index.mjs 四处，
// 想改一个字段得先猜「这张表是谁建的」。现在只有这一处。
//
// 三条约定：
//   1. **只写当前形态**，不写 ALTER 升级脚本。线上只到 v0.1.1b（4 张账号表），其余表都还没上线，
//      改它们的字段就直接改这里的 CREATE，本地 `npm run db:reset` 重建 —— 没有线上数据要兼容，就不做迁移。
//      唯一的例外是 users 的头像三列：线上 users 已存在，只能由 v0.2.0b 段的 `steps` 用 ALTER 补。
//   2. 每句都是 `CREATE TABLE IF NOT EXISTS`，重复执行不报错。
//   3. 执行到哪个版本记在 `schema_migrations` 里（见文件末尾），跑过的版本不再重跑。
//
// 一张表里的顺序：业务列 → 时间列 → 主键 → 唯一键 → 索引 → 外键。外键要指向的表必须排在它前面。
import {transaction} from './db.mjs';

// ======================= v0.1.0b · 账号 =======================

const accounts = [
  // 用户。v0.1.1b 上线时就是这个形态；头像三列是 v0.2.0b 加的，见文件末尾的 addAvatarColumns。
  `CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    email VARCHAR(254) NOT NULL COMMENT '规范化为小写后的邮箱',
    password_hash VARCHAR(255) NULL DEFAULT NULL COMMENT 'scrypt$N$r$p$salt$hash；只用验证码登录过的账号为 NULL',
    email_verified_at DATETIME NULL DEFAULT NULL COMMENT '首次通过验证码验证的时间；NULL 表示还没验证过',
    nickname VARCHAR(24) NOT NULL DEFAULT '' COMMENT '必填项；空字符串表示还没填',
    bio VARCHAR(160) NOT NULL DEFAULT '' COMMENT '一句话介绍，可选',
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL COMMENT '资料更新时间；登录不改这一列',
    PRIMARY KEY (id),
    UNIQUE KEY uniq_users_email (email)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='社区用户（邮箱唯一）'`,

  // 一行 = 一个浏览器的登录流程。challenge 唯一，所以「重发」是替换而不是新增：
  // 同一浏览器同一邮箱只认最近一次被接受的发送，多设备各占一行、互不影响。
  `CREATE TABLE IF NOT EXISTS login_email_captcha (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    challenge CHAR(24) NOT NULL COMMENT 'base64url 随机串，放在 HttpOnly cookie nc_chal 里',
    email VARCHAR(254) NOT NULL,
    code_hmac CHAR(64) NOT NULL COMMENT 'HMAC-SHA256(secret, challenge:emailCaptcha)；没填 emailCaptcha 时是占位空串',
    attempts TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '已猜错次数；达到 auth.maxAttempts 后整枚作废',
    consumed_at DATETIME NULL DEFAULT NULL COMMENT '被成功消费的时间；NULL 表示还没用掉',
    expires_at DATETIME NOT NULL COMMENT '过期时间（auth.codeMinutes，默认 10 分钟）',
    created_at DATETIME NOT NULL,
    ip_hash CHAR(64) NOT NULL DEFAULT '' COMMENT '来源 IP 的 HMAC，仅用于审计',
    PRIMARY KEY (id),
    UNIQUE KEY uniq_captcha_challenge (challenge),
    KEY idx_captcha_email (email, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='邮箱验证码挑战（一行 = 一个浏览器的登录流程）'`,

  // 会话只存令牌哈希：cookie nc_sid 里那串原文永远不落库。
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash CHAR(64) NOT NULL COMMENT 'sha256(会话令牌)，令牌原文只在 cookie nc_sid 里',
    user_id BIGINT UNSIGNED NOT NULL COMMENT '外键 → users.id；删号时这条会话跟着删',
    created_at DATETIME NOT NULL,
    last_seen_at DATETIME NOT NULL COMMENT '最近一次活跃；最多每小时写一次',
    expires_at DATETIME NOT NULL COMMENT '绝对到期；空闲到期另按 last_seen_at 判定',
    ua_hash CHAR(64) NOT NULL DEFAULT '' COMMENT 'UA 的 sha256，多设备时用于区分',
    PRIMARY KEY (token_hash),
    KEY idx_sessions_user (user_id),
    CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='登录会话（只存令牌哈希，7 天绝对 + 24 小时空闲）'`,

  // 频率计数落库（不是内存）：多实例部署时也准，重启不丢。
  `CREATE TABLE IF NOT EXISTS rate_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    kind VARCHAR(16) NOT NULL COMMENT 'send 发码 / verify_fail 猜错码 / login_fail 猜错密码 / avatar_write 换头像',
    subject CHAR(64) NOT NULL COMMENT 'HMAC(email) 或 HMAC(ip)，不存明文',
    at DATETIME NOT NULL COMMENT '事件时间；所有窗口都按它算',
    PRIMARY KEY (id),
    KEY idx_rate_lookup (kind, subject, at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='发信与猜错频率，登录成功会清空该邮箱的记录'`
];

// ======================= v0.1.1b · 资料页 =======================
// 只改了模板（昵称/简介可编辑），没有表结构变化 —— 这一版留空是记录「确实没有 DDL」。

// ======================= v0.2.0b · 论坛 =======================
// 三条贯穿全段的约定：
//   1. **内容不可编辑**：帖子与回复发布后只能删，所以没有 version / updated_at；
//      删除是改 status（两个 deleted 值），没有 hidden —— 版务也只能走举报流程。
//   2. **时间一律 DATETIME（秒）**，写入前把毫秒抹掉，与库里保持一致。
//   3. **发号器跟着宿主行走**：回复的 sequence 来自 posts.next_sequence，消息的 sequence 来自
//      dm_conversations.last_seq，都在事务里 SELECT ... FOR UPDATE 取号，避免并发撞唯一键。

const forum = [
  // 论坛身份。有这一行才不是「完全普通的成员」——要么有版务权限，要么正在被处罚。
  // 一行只有一种 `type`，所以「版务被禁言」= 类型改成 ban/mute（解封后要重新任命）：
  // 用两列（角色 + 处罚）表达反而会出现「既是版务又被封」这种既然后果含糊的组合。
  // `expired_at` 对三种类型都适用：处罚到期自动解除，moderator/admin 到期自动卸任；NULL = 永久。
  // mute 与 ban 的差别只在「拦哪些动作」，见 base.mjs 的 checkMember()：
  //   mute = 只拦公开发言（发帖/回复/投票/举报/传图），私信与收藏关注照旧
  //   ban  = 拦全部写动作
  // 两者都**不影响登录与浏览**（处罚是社区内的，不是账号层面的）。
  // ⚠️ 读的时候一律要把「已过期」当成没有这一行 —— 见 base.mjs 的 memberType()。
  `CREATE TABLE IF NOT EXISTS forum_member_roles (
    member_id BIGINT UNSIGNED NOT NULL COMMENT '→ users.id',
    type ENUM('mute','ban','moderator','admin') NOT NULL COMMENT 'mute=禁言；ban=封禁；moderator/admin=版务；新增分类只改这里',
    expired_at DATETIME NULL DEFAULT NULL COMMENT '生效到什么时候；NULL 表示永久',
    created_at DATETIME NOT NULL COMMENT '这次任命/处罚的生效时间',
    PRIMARY KEY (member_id),
    KEY idx_roles_expiry (expired_at) COMMENT '清过期行用',
    FOREIGN KEY (member_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='论坛身份与处罚（有行即非普通成员）'`,

  // 主题帖。next_sequence 是回复发号器：事务里取号后 +1，替代 MAX(sequence)+1（并发会撞唯一键）。
  `CREATE TABLE IF NOT EXISTS forum_posts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    poster_id BIGINT UNSIGNED NOT NULL COMMENT '作者 → users.id',
    category VARCHAR(24) NOT NULL COMMENT '分类白名单',
    title VARCHAR(80) NOT NULL COMMENT '4-80 字',
    content MEDIUMTEXT NOT NULL COMMENT 'markdown 原文；发布后不可编辑',
    status ENUM('published','deleted_by_author','deleted_by_report') NOT NULL DEFAULT 'published' COMMENT '只有 published 对外可见',
    next_sequence INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '回复发号器',
    reply_count INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '已发布回复数（冗余，列表展示用）',
    client_request_key VARCHAR(80) NULL DEFAULT NULL COMMENT '前端幂等键；NULL 不参与唯一性',
    created_at DATETIME NOT NULL,
    last_activity_at DATETIME NOT NULL COMMENT '列表排序用的冗余时间',
    PRIMARY KEY (id),
    UNIQUE KEY uniq_posts_request (poster_id, client_request_key),
    KEY idx_posts_activity (status, last_activity_at, id),
    KEY idx_posts_category (status, category, last_activity_at, id),
    KEY idx_posts_poster (poster_id, created_at, id),
    FOREIGN KEY (poster_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='主题帖（发布后不可改，只能删）'`,

  // 回复。sequence 是帖内楼层号；parent_reply 是楼中楼，可以为空（所以不能进主键）。
  `CREATE TABLE IF NOT EXISTS forum_post_replies (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    post_id BIGINT UNSIGNED NOT NULL COMMENT '→ forum_posts.id',
    poster_id BIGINT UNSIGNED NOT NULL COMMENT '作者 → users.id',
    parent_reply BIGINT UNSIGNED NULL DEFAULT NULL COMMENT '楼中楼父回复；NULL 表示直接回帖',
    sequence INT UNSIGNED NOT NULL COMMENT '帖内楼层号，来自 posts.next_sequence',
    content TEXT NOT NULL COMMENT '1-3000 字',
    status ENUM('published','deleted_by_author','deleted_by_report') NOT NULL DEFAULT 'published',
    client_request_key VARCHAR(80) NULL DEFAULT NULL COMMENT '前端幂等键',
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_replies_sequence (post_id, sequence),
    UNIQUE KEY uniq_replies_request (poster_id, client_request_key),
    KEY idx_replies_poster (poster_id, created_at),
    FOREIGN KEY (post_id) REFERENCES forum_posts(id),
    FOREIGN KEY (poster_id) REFERENCES users(id),
    FOREIGN KEY (parent_reply) REFERENCES forum_post_replies(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='回复（发布后不可改，只能删）'`,

  // 帖子投票。复合主键保证一人一票；取「我赞过什么」要反向索引。
  `CREATE TABLE IF NOT EXISTS forum_post_votes (
    post_id BIGINT UNSIGNED NOT NULL,
    voter BIGINT UNSIGNED NOT NULL,
    vote_type ENUM('up','down') NOT NULL,
    PRIMARY KEY (post_id, voter),
    KEY idx_post_votes_voter (voter, post_id),
    FOREIGN KEY (post_id) REFERENCES forum_posts(id),
    FOREIGN KEY (voter) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='帖子赞踩（一人一票）'`,

  `CREATE TABLE IF NOT EXISTS forum_reply_votes (
    reply_id BIGINT UNSIGNED NOT NULL,
    voter BIGINT UNSIGNED NOT NULL,
    vote_type ENUM('up','down') NOT NULL,
    PRIMARY KEY (reply_id, voter),
    KEY idx_reply_votes_voter (voter, reply_id),
    FOREIGN KEY (reply_id) REFERENCES forum_post_replies(id),
    FOREIGN KEY (voter) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='回复赞踩（一人一票）'`,

  // 收藏。主键按 (user_id, post_id) 排：最热的查询是「我的收藏」，走聚簇索引。
  `CREATE TABLE IF NOT EXISTS forum_post_bookmarks (
    user_id BIGINT UNSIGNED NOT NULL,
    post_id BIGINT UNSIGNED NOT NULL,
    folder VARCHAR(24) NULL DEFAULT NULL COMMENT '收藏夹；NULL 表示默认夹',
    created_at DATETIME NOT NULL,
    PRIMARY KEY (user_id, post_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (post_id) REFERENCES forum_posts(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='收藏（一人一帖一行）'`,

  // 关注关系。两列都指向 users；复合主键保证「一人对另一人只有一行」，反向查询走 idx_follows_fans。
  `CREATE TABLE IF NOT EXISTS forum_follows (
    follower_id BIGINT UNSIGNED NOT NULL COMMENT '关注者',
    followed_id BIGINT UNSIGNED NOT NULL COMMENT '被关注者',
    created_at DATETIME NOT NULL,
    PRIMARY KEY (follower_id, followed_id),
    KEY idx_follows_fans (followed_id, follower_id),
    CHECK (follower_id <> followed_id),
    FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (followed_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='关注关系'`,

  // 帖子图片的引用与元信息。post_id 为空 = 还没发出去的草稿图，定时清理靠它。
  // 键是服务端生成的 UUID（对象身份，不是路径）；etag 只做去重参考，**不唯一**
  // —— 两个人传同一张图各存一份，删除时谁也不用管别人。
  `CREATE TABLE IF NOT EXISTS forum_images (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '对外 URL 用它',
    poster_id BIGINT UNSIGNED NOT NULL COMMENT '上传者 → users.id',
    post_id BIGINT UNSIGNED NULL DEFAULT NULL COMMENT '→ forum_posts.id；NULL 表示草稿图',
    etag CHAR(64) NOT NULL COMMENT '内容 sha256，仅作去重参考',
    storage_driver VARCHAR(32) NOT NULL,
    storage_key VARCHAR(80) NOT NULL COMMENT '服务端 UUID，不是路径',
    content_type VARCHAR(32) NOT NULL,
    byte_size INT UNSIGNED NOT NULL,
    width SMALLINT UNSIGNED NOT NULL,
    height SMALLINT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_images_object (storage_driver, storage_key),
    KEY idx_images_post (post_id, id),
    KEY idx_images_drafts (poster_id, created_at),
    FOREIGN KEY (poster_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (post_id) REFERENCES forum_posts(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='帖子图片引用与元信息'`,

  // 图片字节。故意不做外键：换对象存储后这里没有对应行，外键会让上传直接失败。
  `CREATE TABLE IF NOT EXISTS forum_image_blobs (
    storage_key VARCHAR(80) NOT NULL,
    content MEDIUMBLOB NOT NULL,
    PRIMARY KEY (storage_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='图片字节（按 storage_key 与 forum_images 对应）'`,

  // 帖子举报。open_key 是生成列：只有 open/reviewing 有值，
  // 所以「同一人对同一帖」只能有一条在处理中；结案后变 NULL，可以再举报（唯一索引允许多个 NULL）。
  `CREATE TABLE IF NOT EXISTS forum_post_reports (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    post_id BIGINT UNSIGNED NOT NULL,
    reporter_id BIGINT UNSIGNED NOT NULL,
    category VARCHAR(32) NOT NULL COMMENT '举报原因',
    detail TEXT NOT NULL COMMENT '5-1000 字',
    status ENUM('open','reviewing','upheld','dismissed','withdrawn') NOT NULL DEFAULT 'open',
    resolution TEXT NULL DEFAULT NULL COMMENT '处理结论；NULL 表示未结案',
    assignee BIGINT UNSIGNED NULL DEFAULT NULL COMMENT '处理人；NULL 表示未分派',
    version INT NOT NULL DEFAULT 1 COMMENT '处理流转的乐观锁',
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    open_key VARCHAR(120) GENERATED ALWAYS AS (CASE WHEN status IN ('open','reviewing') THEN CONCAT(reporter_id,':',post_id) ELSE NULL END) STORED COMMENT '处理中的唯一标识',
    PRIMARY KEY (id),
    UNIQUE KEY uniq_post_report_open (open_key),
    KEY idx_post_reports_status (status, id),
    KEY idx_post_reports_reporter (reporter_id, id),
    FOREIGN KEY (post_id) REFERENCES forum_posts(id),
    FOREIGN KEY (reporter_id) REFERENCES users(id),
    FOREIGN KEY (assignee) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='帖子举报'`,

  // 回复举报。结构同上；post_id 是冗余定位，方便「按帖聚合举报」。
  `CREATE TABLE IF NOT EXISTS forum_reply_reports (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    reply_id BIGINT UNSIGNED NOT NULL,
    post_id BIGINT UNSIGNED NOT NULL COMMENT '冗余：该回复属于哪一帖',
    reporter_id BIGINT UNSIGNED NOT NULL,
    category VARCHAR(32) NOT NULL,
    detail TEXT NOT NULL,
    status ENUM('open','reviewing','upheld','dismissed','withdrawn') NOT NULL DEFAULT 'open',
    resolution TEXT NULL DEFAULT NULL,
    assignee BIGINT UNSIGNED NULL DEFAULT NULL,
    version INT NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    open_key VARCHAR(120) GENERATED ALWAYS AS (CASE WHEN status IN ('open','reviewing') THEN CONCAT(reporter_id,':',reply_id) ELSE NULL END) STORED,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_reply_report_open (open_key),
    KEY idx_reply_reports_status (status, id),
    KEY idx_reply_reports_reporter (reporter_id, id),
    KEY idx_reply_reports_post (post_id, id),
    FOREIGN KEY (reply_id) REFERENCES forum_post_replies(id),
    FOREIGN KEY (post_id) REFERENCES forum_posts(id),
    FOREIGN KEY (reporter_id) REFERENCES users(id),
    FOREIGN KEY (assignee) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='回复举报'`,

  // 收件箱。event_key 是语义串（like:post:12:actor:7），保证同一事件只落一条；
  // sender 可空 —— 系统通知没有触发者。
  `CREATE TABLE IF NOT EXISTS forum_notifications (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    receiver BIGINT UNSIGNED NOT NULL COMMENT '收件人 → users.id',
    sender BIGINT UNSIGNED NULL DEFAULT NULL COMMENT '触发者；NULL 表示系统事件',
    category VARCHAR(24) NOT NULL COMMENT 'reply|like|follow|report_result',
    target_type VARCHAR(16) NOT NULL COMMENT 'post|reply|dm_message（多态，无外键）',
    target_id BIGINT UNSIGNED NOT NULL COMMENT '多态目标编号',
    event_key VARCHAR(160) NOT NULL COMMENT '语义幂等键',
    created_at DATETIME NOT NULL,
    read_at DATETIME NULL DEFAULT NULL COMMENT 'NULL 表示未读',
    PRIMARY KEY (id),
    UNIQUE KEY uniq_notice_event (receiver, event_key),
    KEY idx_notice_inbox (receiver, id),
    FOREIGN KEY (receiver) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (sender) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='通知收件箱'`,

  // 限流。一行 = 一个用户的一个动作在某个固定窗口内的次数。
  // 用 ON DUPLICATE KEY UPDATE 原子自增：count = IF(window_start < 窗口起点, 1, count+1)。
  // 叫 hits 不叫 count，避免和聚合函数同名。
  `CREATE TABLE IF NOT EXISTS forum_post_rate_limits (
    user_id BIGINT UNSIGNED NOT NULL,
    action VARCHAR(32) NOT NULL COMMENT 'post_create|reply_create|image_upload',
    window_start DATETIME NOT NULL COMMENT '当前窗口起点',
    hits INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '窗口内已用次数',
    PRIMARY KEY (user_id, action),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='固定窗口限流计数'`,

  // 拉黑。双向都能查：我拉黑了谁（聚簇）、谁拉黑了我（反向索引）。
  `CREATE TABLE IF NOT EXISTS forum_user_blocks (
    blocker_id BIGINT UNSIGNED NOT NULL,
    blocked_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (blocker_id, blocked_id),
    KEY idx_blocks_blocked (blocked_id),
    FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='拉黑关系'`
];

// ======================= v0.2.0b · 私信 =======================

const directMessages = [
  // 一对一（或未来群聊）会话。user_low / user_high 是生成列：
  // 应用层怎么存都能算出同一对，UNIQUE 才真正保证「同一对人只有一个会话」。
  // ⚠️ 必须是 VIRTUAL 不能是 STORED —— MySQL 不允许「STORED 生成列引用的列」带 ON DELETE CASCADE
  //    （级联改 user_a 时要重算已物化的列），会直接报 ER_CANNOT_ADD_FOREIGN(1215)。
  `CREATE TABLE IF NOT EXISTS forum_dm_conversations (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_a BIGINT UNSIGNED NOT NULL COMMENT '参与者 A → users.id（无序）',
    user_b BIGINT UNSIGNED NOT NULL COMMENT '参与者 B → users.id（无序）',
    user_low BIGINT UNSIGNED GENERATED ALWAYS AS (LEAST(user_a,user_b)) VIRTUAL COMMENT '较小的编号',
    user_high BIGINT UNSIGNED GENERATED ALWAYS AS (GREATEST(user_a,user_b)) VIRTUAL COMMENT '较大的编号',
    last_seq INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '消息发号器',
    last_message_at DATETIME NOT NULL COMMENT '会话列表排序用的冗余时间',
    PRIMARY KEY (id),
    UNIQUE KEY uniq_dm_pair (user_low, user_high),
    FOREIGN KEY (user_a) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (user_b) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='私信会话（按有序用户对唯一）'`,

  // 参与者在会话里的视图状态：读到哪、是否隐藏/退出。删会话 = 把自己的进度推到底。
  `CREATE TABLE IF NOT EXISTS forum_dm_members (
    conversation_id BIGINT UNSIGNED NOT NULL,
    member_id BIGINT UNSIGNED NOT NULL,
    status ENUM('active','hidden','left') NOT NULL DEFAULT 'active' COMMENT 'active 正常；hidden 不出现在列表；left 已退出',
    last_read_seq INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '已读到的消息序号',
    PRIMARY KEY (conversation_id, member_id),
    KEY idx_dm_member (member_id, conversation_id),
    FOREIGN KEY (conversation_id) REFERENCES forum_dm_conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (member_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='会话参与者与读进度'`,

  // 消息。sequence 来自会话的 last_seq；client_message_id 挡双击。
  `CREATE TABLE IF NOT EXISTS forum_dm_messages (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    conversation_id BIGINT UNSIGNED NOT NULL,
    sequence INT UNSIGNED NOT NULL COMMENT '会话内序号，来自 conversations.last_seq',
    sender_id BIGINT UNSIGNED NOT NULL,
    client_message_id VARCHAR(80) NOT NULL COMMENT '前端幂等键',
    body TEXT NOT NULL COMMENT '1-2000 字',
    status ENUM('published','deleted_by_author','deleted_by_report') NOT NULL DEFAULT 'published',
    sent_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_dm_sequence (conversation_id, sequence),
    UNIQUE KEY uniq_dm_client (sender_id, client_message_id),
    FOREIGN KEY (conversation_id) REFERENCES forum_dm_conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='私信消息'`,

  // 私信举报。open_key 粒度是「一条消息」，规则与帖子举报相同。
  `CREATE TABLE IF NOT EXISTS forum_dm_reports (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    conversation_id BIGINT UNSIGNED NOT NULL,
    message_id BIGINT UNSIGNED NOT NULL,
    reporter_id BIGINT UNSIGNED NOT NULL,
    reason VARCHAR(32) NOT NULL,
    detail TEXT NOT NULL,
    status ENUM('open','reviewing','upheld','dismissed','withdrawn') NOT NULL DEFAULT 'open',
    resolution TEXT NULL DEFAULT NULL,
    assignee BIGINT UNSIGNED NULL DEFAULT NULL,
    version INT NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    open_key VARCHAR(120) GENERATED ALWAYS AS (CASE WHEN status IN ('open','reviewing') THEN CONCAT(reporter_id,':',message_id) ELSE NULL END) STORED,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_dm_report_open (open_key),
    KEY idx_dm_reports_status (status, id),
    KEY idx_dm_reports_reporter (reporter_id, id),
    FOREIGN KEY (conversation_id) REFERENCES forum_dm_conversations(id),
    FOREIGN KEY (message_id) REFERENCES forum_dm_messages(id),
    FOREIGN KEY (reporter_id) REFERENCES users(id),
    FOREIGN KEY (assignee) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='私信举报'`
];

// ======================= v0.2.0b · 头像 =======================

const avatars = [
  // 头像是「对象表 + users 上的引用」：字节在这里，谁在用哪段字节记在 users。
  // 键是服务端生成的 UUID（对象身份，不是人的身份），所以换头像 = 写新对象 → 换引用 → 删旧对象，
  // 任何一步失败都还有旧对象可用；用 user_id 当键就变成原地覆盖 BLOB，写坏即丢图。
  `CREATE TABLE IF NOT EXISTS avatar_blobs (
    storage_key VARCHAR(80) PRIMARY KEY,
    content_type VARCHAR(32) NOT NULL DEFAULT 'image/webp',
    created_at DATETIME NOT NULL COMMENT '这段字节什么时候写进来的',
    content MEDIUMBLOB NOT NULL
  ) ENGINE=InnoDB`
];

// ======================= 版本表 =======================

/**
 * v0.2.0b 的增量：给**已上线的 v0.1.1b 库**补头像的三列。
 *
 * 为什么不能只写在 users 的 CREATE 里：线上库的 users 已经存在，
 * `CREATE TABLE IF NOT EXISTS` 是空操作，那三列永远不会出现。
 * 新库走同一条路 —— 先建 v0.1.0b 的表，再 ALTER 补列，两条路的终点完全一致。
 * @param {object} c 事务连接。
 * @returns {Promise<void>} 无。
 */
async function addAvatarColumns(c){
  const [rows] = await c.query('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', ['users']);
  const have = new Set(rows.map(row => row.COLUMN_NAME));
  const columns = [
    ['avatar_storage_driver', `avatar_storage_driver VARCHAR(32) NULL DEFAULT NULL COMMENT '头像字节存在哪种驱动里（mysql / 对象存储…）'`],
    ['avatar_storage_key', `avatar_storage_key VARCHAR(80) NULL DEFAULT NULL COMMENT '头像对象的键；服务端生成的 UUID，不是路径'`],
    ['avatar_etag', `avatar_etag CHAR(64) NULL DEFAULT NULL COMMENT '头像内容 SHA-256，用于 304 回源校验'`]
  ];
  for(const [name, ddl] of columns){
    if(!have.has(name))
      await c.query(`ALTER TABLE users ADD COLUMN ${ddl}`);
  }
  const [indexes] = await c.query('SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', ['users']);
  if(!indexes.some(row => row.INDEX_NAME === 'uniq_users_avatar'))
    await c.query('ALTER TABLE users ADD UNIQUE KEY uniq_users_avatar (avatar_storage_driver, avatar_storage_key)');
}

/**
 * 按版本组织的全部建表语句。版本号 = git tag，顺序即执行顺序。
 *
 * 每一段只包含「这个版本新增的表」；段内顺序保证外键指向的表先建。
 * 注意 users 排在所有论坛/私信表之前 —— 它们的外键都指向它。
 *
 * **v0.1.2b 从未发布**：论坛、私信、头像这一整批改动直接随 v0.2.0b 上线，
 * 所以 tag 列表里只有 v0.1.0b → v0.1.1b → v0.2.0b 三段，中间没有 v0.1.2b。
 *
 * `steps` 是 SQL 表达不了的增量（给已存在的表加列/加索引），只在整段还没跑过时执行一次，
 * 里面照样要自己判重（见 addAvatarColumns）。
 */
export const schemaVersions = [
  {version: 'v0.1.0b', note: '账号：邮箱验证码登录、会话、限流', tables: accounts},
  {version: 'v0.1.1b', note: '资料页可编辑（只改模板，无表结构变化）', tables: []},
  {version: 'v0.2.0b', note: '论坛、私信、头像（线上从 v0.1.1b 升上来）', tables: [...forum, ...directMessages, ...avatars], steps: [addAvatarColumns]}
];

/** 所有建表语句（按执行顺序摊平）。`db:migrate --print` 和 `db:check` 都用它。 */
export const schemaStatements = schemaVersions.flatMap(entry => entry.tables);

/** 全部表名（从语句里解析，不维护第二份清单）。 */
export const tableNames = schemaStatements.map(statement => /CREATE TABLE IF NOT EXISTS (\w+)/.exec(statement)?.[1]).filter(Boolean);

/** 版本记录表本身。它不是业务表，所以不放在上面的版本段里。 */
export const migrationsTable = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(32) PRIMARY KEY,
  note VARCHAR(160) NOT NULL DEFAULT '',
  applied_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='已执行到哪个版本（git tag）'`;

// ======================= 执行 =======================

/**
 * 建表：逐版本执行没跑过的段，跑完记一行版本号。
 *
 * 为什么还要版本表：段里的语句本身幂等，重建库时谈不上「跳过」；但线上排查时能一眼看出
 * 「这个库停在哪个 tag」，也避免将来加数据迁移时重复执行。
 * DDL 在 MySQL 里会隐式提交，所以拿一把具名咨询锁把并发部署串起来（两个实例同时启动只有一个在跑）。
 * @returns {Promise<string[]>} 本次实际执行的版本号。
 */
export async function migrateSchema(){
  const applied = [];
  await transaction(async c => {
    const [[lock]] = await c.query("SELECT GET_LOCK('nanocamp_schema',30) AS ok");
    if(!lock.ok)
      throw Error('Schema migration locked');
    try{
      await c.query(migrationsTable);
      const [rows] = await c.query('SELECT version FROM schema_migrations');
      const done = new Set(rows.map(row => row.version));
      for(const entry of schemaVersions){
        if(done.has(entry.version))
          continue;
        for(const statement of entry.tables)
          await c.query(statement);
        for(const step of entry.steps || [])
          await step(c);
        await c.execute('INSERT INTO schema_migrations(version,note,applied_at) VALUES (?,?,?)', [entry.version, entry.note, new Date()]);
        applied.push(entry.version);
      }
    }
    finally{
      await c.query("SELECT RELEASE_LOCK('nanocamp_schema')");
    }
  });
  return applied;
}
