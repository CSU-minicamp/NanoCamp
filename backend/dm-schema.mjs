export const dmSchema=[
`CREATE TABLE IF NOT EXISTS forum_dm_conversations (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, user_low BIGINT UNSIGNED NOT NULL, user_high BIGINT UNSIGNED NOT NULL,
 last_seq INT UNSIGNED NOT NULL DEFAULT 0,
 last_message_at DATETIME(3) NOT NULL, UNIQUE KEY uniq_dm_pair(user_low,user_high),
 FOREIGN KEY(user_low) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY(user_high) REFERENCES users(id) ON DELETE CASCADE)`,
`CREATE TABLE IF NOT EXISTS forum_dm_members (
 conversation_id BIGINT UNSIGNED NOT NULL,user_id BIGINT UNSIGNED NOT NULL,last_read_seq INT UNSIGNED NOT NULL DEFAULT 0,
 hidden_through_seq INT UNSIGNED NULL, PRIMARY KEY(conversation_id,user_id), INDEX idx_dm_member(user_id,conversation_id),
 FOREIGN KEY(conversation_id) REFERENCES forum_dm_conversations(id) ON DELETE CASCADE,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`,
`CREATE TABLE IF NOT EXISTS forum_dm_messages (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,conversation_id BIGINT UNSIGNED NOT NULL,seq INT UNSIGNED NOT NULL,
 sender_id BIGINT UNSIGNED NOT NULL,client_message_id VARCHAR(80) NOT NULL,body TEXT NOT NULL,
 status ENUM('published','hidden') NOT NULL DEFAULT 'published',created_at DATETIME(3) NOT NULL,
 UNIQUE KEY uniq_dm_seq(conversation_id,seq),UNIQUE KEY uniq_dm_client(sender_id,client_message_id),
 FOREIGN KEY(conversation_id) REFERENCES forum_dm_conversations(id) ON DELETE CASCADE,
 FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE)`,
`CREATE TABLE IF NOT EXISTS forum_user_blocks (
 blocker_id BIGINT UNSIGNED NOT NULL,blocked_id BIGINT UNSIGNED NOT NULL,created_at DATETIME NOT NULL,
 PRIMARY KEY(blocker_id,blocked_id),FOREIGN KEY(blocker_id) REFERENCES users(id) ON DELETE CASCADE,
 FOREIGN KEY(blocked_id) REFERENCES users(id) ON DELETE CASCADE)`,
`CREATE TABLE IF NOT EXISTS forum_dm_reports (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,reporter_id BIGINT UNSIGNED NOT NULL,conversation_id BIGINT UNSIGNED NOT NULL,
 message_id BIGINT UNSIGNED NOT NULL,reason VARCHAR(32) NOT NULL,details TEXT NOT NULL,
 status ENUM('open','reviewing','upheld','dismissed','withdrawn') NOT NULL DEFAULT 'open',assigned_to BIGINT UNSIGNED NULL,
 resolution TEXT NULL,version INT NOT NULL DEFAULT 1,created_at DATETIME NOT NULL,updated_at DATETIME NOT NULL,
 open_key VARCHAR(120) GENERATED ALWAYS AS (CASE WHEN status IN ('open','reviewing') THEN CONCAT(reporter_id,':',message_id) ELSE NULL END) STORED,
 UNIQUE KEY uniq_dm_report(open_key),INDEX idx_dm_reporter(reporter_id,id),
 FOREIGN KEY(reporter_id) REFERENCES users(id),FOREIGN KEY(conversation_id) REFERENCES forum_dm_conversations(id),
 FOREIGN KEY(message_id) REFERENCES forum_dm_messages(id))`
].map(sql=>sql+' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');

// Remove only the obsolete request workflow columns; conversation/message identities stay intact.
export async function migrateDirectMessages(connection){
 const [columns]=await connection.execute("SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='forum_dm_conversations' AND COLUMN_NAME IN ('initiator_id','state','request_state')");
 const allowed=new Set(['initiator_id','state','request_state']);
 for(const column of columns){const name=column.COLUMN_NAME;if(!allowed.has(name))throw Error('Unexpected private-message migration column');await connection.query('ALTER TABLE forum_dm_conversations DROP COLUMN `'+name+'`');}
 await connection.execute('INSERT IGNORE INTO forum_schema_migrations(version,applied_at) VALUES (?,?)',['forum-dm-direct-v2',new Date()]);
}
