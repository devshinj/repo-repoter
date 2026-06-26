// src/infra/db/schema.ts
// SQLite 시대의 createTables / migrateSchema 는 connection.ts 의 createTables()
// (private async)로 완전히 흡수되었다. 이 파일은 하위 호환을 위한 스텁으로만 존재한다.
// 모든 테이블 DDL 및 initDb()는 @/infra/db/connection 을 참조할 것.

export {};
