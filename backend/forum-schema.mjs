import {transaction} from './db.mjs';
import {dmSchema,migrateDirectMessages} from './dm-schema.mjs';

export const forumSchema = [
`CREATE TABLE IF NOT EXISTS forum_schema_migrations (version VARCHAR(64) PRIMARY KEY, applied_at DATETIME NOT NULL)`,
`CREATE TABLE IF NOT EXISTS forum_members (
 user_id BIGINT UNSIGNED PRIMARY KEY, role ENUM('member','moderator','admin') NOT NULL DEFAULT 'member',
 suspended_until DATETIME NULL, banned_at DATETIME NULL,
 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
`CREATE TABLE IF NOT EXISTS forum_topics (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, author_id BIGINT UNSIGNED NOT NULL,
 category VARCHAR(24) NOT NULL, title VARCHAR(80) NOT NULL, body MEDIUMTEXT NOT NULL,
 status ENUM('published','withdrawn','hidden') NOT NULL DEFAULT 'published', version INT NOT NULL DEFAULT 1,
 reply_count INT NOT NULL DEFAULT 0, last_activity_at DATETIME NOT NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
 FOREIGN KEY(author_id) REFERENCES users(id), INDEX idx_topics_activity(status,last_activity_at,id),
 INDEX idx_topics_category(status,category,last_activity_at,id), INDEX idx_topics_author(author_id,created_at,id))`,
`CREATE TABLE IF NOT EXISTS forum_replies (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, topic_id BIGINT UNSIGNED NOT NULL, author_id BIGINT UNSIGNED NOT NULL,
 parent_id BIGINT UNSIGNED NULL, body TEXT NOT NULL, status ENUM('published','withdrawn','hidden') NOT NULL DEFAULT 'published',
 version INT NOT NULL DEFAULT 1, sequence INT NOT NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
 FOREIGN KEY(topic_id) REFERENCES forum_topics(id), FOREIGN KEY(author_id) REFERENCES users(id),
 FOREIGN KEY(parent_id) REFERENCES forum_replies(id), UNIQUE KEY uniq_reply_sequence(topic_id,sequence),
 INDEX idx_replies_list(topic_id,sequence), INDEX idx_replies_author(author_id,created_at),INDEX idx_replies_own(topic_id,author_id,status,sequence))`,
`CREATE TABLE IF NOT EXISTS forum_image_blobs (storage_key VARCHAR(80) PRIMARY KEY,content MEDIUMBLOB NOT NULL) ENGINE=InnoDB`,
`CREATE TABLE IF NOT EXISTS forum_images (
 id CHAR(36) PRIMARY KEY,owner_id BIGINT UNSIGNED NOT NULL,topic_id BIGINT UNSIGNED NULL,
 storage_driver VARCHAR(32) NOT NULL,storage_key VARCHAR(80) NOT NULL,content_type VARCHAR(32) NOT NULL,
 byte_size INT UNSIGNED NOT NULL,width SMALLINT UNSIGNED NOT NULL,height SMALLINT UNSIGNED NOT NULL,
 etag CHAR(64) NOT NULL,created_at DATETIME NOT NULL,
 UNIQUE KEY uniq_forum_image_object(storage_driver,storage_key),INDEX idx_forum_images_drafts(topic_id,created_at),
 FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE,FOREIGN KEY(topic_id) REFERENCES forum_topics(id) ON DELETE CASCADE) ENGINE=InnoDB`,
...['topic','reply'].map(kind => `CREATE TABLE IF NOT EXISTS forum_${kind}_votes (
 target_id BIGINT UNSIGNED NOT NULL, user_id BIGINT UNSIGNED NOT NULL, value TINYINT NOT NULL,
 PRIMARY KEY(target_id,user_id), CHECK(value IN(-1,1)),
 FOREIGN KEY(target_id) REFERENCES forum_${kind === 'topic' ? 'topics' : 'replies'}(id), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`),
`CREATE TABLE IF NOT EXISTS forum_follows (
 follower_id BIGINT UNSIGNED NOT NULL, followed_id BIGINT UNSIGNED NOT NULL, created_at DATETIME NOT NULL,
 PRIMARY KEY(follower_id,followed_id), INDEX idx_fans(followed_id,follower_id), CHECK(follower_id<>followed_id),
 FOREIGN KEY(follower_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY(followed_id) REFERENCES users(id) ON DELETE CASCADE)`,
`CREATE TABLE IF NOT EXISTS forum_bookmarks (
 user_id BIGINT UNSIGNED NOT NULL, topic_id BIGINT UNSIGNED NOT NULL, created_at DATETIME NOT NULL,
 PRIMARY KEY(user_id,topic_id), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY(topic_id) REFERENCES forum_topics(id))`,
`CREATE TABLE IF NOT EXISTS forum_notifications (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL, actor_id BIGINT UNSIGNED NULL,
 kind VARCHAR(24) NOT NULL, target_type VARCHAR(16) NOT NULL, target_id BIGINT UNSIGNED NOT NULL,
 event_key VARCHAR(160) NOT NULL, read_at DATETIME NULL, created_at DATETIME NOT NULL,
 UNIQUE KEY uniq_notice(user_id,event_key), INDEX idx_notice_user(user_id,id),
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY(actor_id) REFERENCES users(id) ON DELETE SET NULL)`,
`CREATE TABLE IF NOT EXISTS forum_reports (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, reporter_id BIGINT UNSIGNED NOT NULL,
 target_type ENUM('topic','reply') NOT NULL, target_id BIGINT UNSIGNED NOT NULL, topic_id BIGINT UNSIGNED NOT NULL,
 reason VARCHAR(32) NOT NULL, details TEXT NOT NULL, status ENUM('open','reviewing','upheld','dismissed','withdrawn') NOT NULL DEFAULT 'open',
 assigned_to BIGINT UNSIGNED NULL, resolution TEXT NULL, version INT NOT NULL DEFAULT 1,
 created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
 open_key VARCHAR(120) GENERATED ALWAYS AS (CASE WHEN status IN ('open','reviewing') THEN CONCAT(reporter_id,':',target_type,':',target_id) ELSE NULL END) STORED,
 UNIQUE KEY uniq_open_report(open_key), INDEX idx_reports_owner(reporter_id,id),
 FOREIGN KEY(reporter_id) REFERENCES users(id), FOREIGN KEY(topic_id) REFERENCES forum_topics(id), FOREIGN KEY(assigned_to) REFERENCES users(id))`,
`CREATE TABLE IF NOT EXISTS forum_audit (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, actor_id BIGINT UNSIGNED NOT NULL, action VARCHAR(32) NOT NULL,
 target_type VARCHAR(16) NOT NULL, target_id BIGINT UNSIGNED NOT NULL, reason TEXT NOT NULL,
 before_state TEXT NOT NULL, after_state TEXT NOT NULL, created_at DATETIME NOT NULL, FOREIGN KEY(actor_id) REFERENCES users(id))`,
`CREATE TABLE IF NOT EXISTS forum_revisions (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, target_type VARCHAR(16) NOT NULL, target_id BIGINT UNSIGNED NOT NULL,
 actor_id BIGINT UNSIGNED NOT NULL, version INT NOT NULL, content MEDIUMTEXT NOT NULL, created_at DATETIME NOT NULL,
 UNIQUE KEY uniq_revision(target_type,target_id,version), FOREIGN KEY(actor_id) REFERENCES users(id))`,
`CREATE TABLE IF NOT EXISTS forum_write_requests (
 user_id BIGINT UNSIGNED NOT NULL, request_key VARCHAR(80) NOT NULL, digest CHAR(64) NOT NULL,
 action VARCHAR(64) NOT NULL, result TEXT NOT NULL, created_at DATETIME NOT NULL,
 PRIMARY KEY(user_id,request_key), INDEX idx_write_rate(user_id,action,created_at), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`
];

export async function migrateForum(){
  // MySQL DDL commits implicitly; an advisory lock serializes concurrent deploys.
  await transaction(async connection => {
    const [[lock]] = await connection.query("SELECT GET_LOCK('nanocamp_forum_migration',10) AS acquired");
    if (!lock.acquired) throw new Error('Forum migration is already running');
    try {
      for (const sql of forumSchema) await connection.query(sql);
      for (const sql of dmSchema) await connection.query(sql);
      await migrateDirectMessages(connection);
      await connection.execute('INSERT IGNORE INTO forum_schema_migrations(version,applied_at) VALUES (?,?)', ['forum-dm-v1',new Date()]);
      const [ownIndex]=await connection.query("SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='forum_replies' AND index_name='idx_replies_own' LIMIT 1");
      if(!ownIndex.length)await connection.query('ALTER TABLE forum_replies ADD INDEX idx_replies_own(topic_id,author_id,status,sequence)');
      await connection.execute('INSERT IGNORE INTO forum_schema_migrations(version,applied_at) VALUES (?,?)', ['forum-v1',new Date()]);
      await connection.execute('INSERT IGNORE INTO forum_schema_migrations(version,applied_at) VALUES (?,?)', ['forum-images-v1',new Date()]);
      await connection.execute('INSERT IGNORE INTO forum_schema_migrations(version,applied_at) VALUES (?,?)', ['forum-own-replies-v1',new Date()]);
    } finally { await connection.query("SELECT RELEASE_LOCK('nanocamp_forum_migration')"); }
  });
}
