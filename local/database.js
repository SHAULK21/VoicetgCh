import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
export function openDatabase(path) {
  if(path!==':memory:') mkdirSync(dirname(path),{recursive:true});
  const sqlite=new DatabaseSync(path);
  sqlite.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS profiles(user_id INTEGER PRIMARY KEY,settings TEXT NOT NULL,words TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS secrets(user_id INTEGER PRIMARY KEY,api_key TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS channels(user_id INTEGER NOT NULL,username TEXT NOT NULL,title TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,cursor INTEGER NOT NULL DEFAULT 0,checked_at INTEGER NOT NULL DEFAULT 0,lease_until INTEGER NOT NULL DEFAULT 0,error TEXT NOT NULL DEFAULT '',UNIQUE(user_id,username));
    CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,source_key TEXT NOT NULL,username TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,date INTEGER NOT NULL,notified INTEGER NOT NULL DEFAULT 0,UNIQUE(user_id,source_key));
    CREATE INDEX IF NOT EXISTS feed_idx ON posts(user_id,id);
    CREATE TABLE IF NOT EXISTS limits(bucket TEXT PRIMARY KEY,used INTEGER NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS command_updates(request_key TEXT PRIMARY KEY,created_at INTEGER NOT NULL);`);
  return {async run(q,p={}) {const result=sqlite.prepare(q).run(p);return {rowsAffected:Number(result.changes),lastInsertRowid:Number(result.lastInsertRowid)};},async get(q,p={}) {return sqlite.prepare(q).get(p)??null;},async all(q,p={}) {return sqlite.prepare(q).all(p);},close:()=>sqlite.close()};
}
