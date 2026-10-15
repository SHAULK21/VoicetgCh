import {table, integer, text, uniqueIndex, index} from 'sdk/db';
export const profiles = table('profiles', {
  user_id: integer().primaryKey(), settings: text().notNull(), words: text().notNull(),
  revision: integer().notNull().default(0),
});
export const secrets = table('secrets', {user_id:integer().primaryKey(), api_key:text().notNull()});
export const channels = table('channels', {
  user_id:integer().notNull(), username:text().notNull(), title:text().notNull(),
  active:integer().notNull().default(1), cursor:integer().notNull().default(0),
  checked_at:integer().notNull().default(0), lease_until:integer().notNull().default(0),
  error:text().notNull().default(''),
}, t=>({owner:uniqueIndex('channel_owner').on(t.user_id,t.username)}));
export const posts = table('posts', {
  id:integer().primaryKey({autoIncrement:true}), user_id:integer().notNull(),
  source_key:text().notNull(), username:text().notNull(), title:text().notNull(),
  body:text().notNull(), date:integer().notNull(), notified:integer().notNull().default(0),
}, t=>({source:uniqueIndex('post_source').on(t.user_id,t.source_key),feed:index('feed_idx').on(t.user_id,t.id)}));
export const limits = table('limits', {bucket:text().primaryKey(), used:integer().notNull(), expires:integer().notNull()});
export const command_updates = table('command_updates',{request_key:text().primaryKey(),created_at:integer().notNull()});
