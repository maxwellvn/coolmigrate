import type { Instance } from "./db";

export class CoolifyError extends Error {}

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Api = ReturnType<typeof api>;
export function api(inst: Pick<Instance, "url" | "token">) {
  async function call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await fetch(`${inst.url}/api/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${inst.token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await r.text();
    let json: any; try { json = JSON.parse(text); } catch { json = text; }
    if (!r.ok) throw new CoolifyError(`${method} ${path} -> ${r.status}: ${typeof json === "string" ? json.slice(0, 500) : JSON.stringify(json)}`);
    return json;
  }
  return {
    get: <T = any>(p: string) => call<T>("GET", p),
    post: <T = any>(p: string, b: unknown) => call<T>("POST", p, b),
    patch: <T = any>(p: string, b: unknown) => call<T>("PATCH", p, b),
    delete: <T = any>(p: string) => call<T>("DELETE", p),
  };
}

export const q = (s: string) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// Coolify API validation (app/Support/ValidationPatterns.php). UI-created DBs may violate these, so we sanitize on copy.
export const ID_RE = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
export const PW_RE = /^[A-Za-z0-9!@#%^*()_+\-=\[\]{}:,.?\/~]+$/;

type Kind = {
  path: string; ids: string[]; pws: string[]; extra: string[];
  ready: (d: any) => string;                 // exit 0 when the engine accepts connections
  dump: (d: any) => string;                  // runs in SOURCE container, writes to stdout
  restore: (d: any, src: any) => string;     // runs in DESTINATION container, reads stdin
  after?: (d: any) => string;                // optional, runs on destination host after restore
  count: (d: any) => string;                 // prints one number for a sanity comparison
};

// Verified against images in use: postgres:16/17/18-alpine, mysql:8, mariadb:11, mongo:7, redis:7.2 (all ship their CLI tools).
export const DB_KINDS: Record<string, Kind> = {
  "standalone-postgresql": {
    path: "postgresql", ids: ["postgres_user", "postgres_db"], pws: ["postgres_password"], extra: ["postgres_initdb_args", "postgres_host_auth_method"],
    ready: (d) => `pg_isready -U ${q(d.postgres_user)} -d ${q(d.postgres_db)}`,
    dump: (d) => `pg_dump --clean --if-exists --no-owner --no-privileges -U ${q(d.postgres_user)} -d ${q(d.postgres_db)}`,
    restore: (d) => `psql -q -U ${q(d.postgres_user)} -d ${q(d.postgres_db)}`,
    count: (d) => `psql -tA -U ${q(d.postgres_user)} -d ${q(d.postgres_db)} -c "select count(*) from pg_tables where schemaname not in ('pg_catalog','information_schema')"`,
  },
  "standalone-mysql": {
    path: "mysql", ids: ["mysql_user", "mysql_database"], pws: ["mysql_root_password", "mysql_password"], extra: [],
    ready: (d) => `mysqladmin ping -uroot -p${q(d.mysql_root_password)} --silent`,
    dump: (d) => `mysqldump -uroot -p${q(d.mysql_root_password)} --single-transaction --routines --triggers --events ${q(d.mysql_database)}`,
    restore: (d) => `mysql -uroot -p${q(d.mysql_root_password)} ${q(d.mysql_database)}`,
    count: (d) => `mysql -uroot -p${q(d.mysql_root_password)} ${q(d.mysql_database)} -N -e "select count(*) from information_schema.tables where table_schema=database()"`,
  },
  "standalone-mariadb": {
    path: "mariadb", ids: ["mariadb_user", "mariadb_database"], pws: ["mariadb_root_password", "mariadb_password"], extra: [],
    ready: (d) => `mariadb-admin ping -uroot -p${q(d.mariadb_root_password)} --silent`,
    dump: (d) => `mariadb-dump -uroot -p${q(d.mariadb_root_password)} --single-transaction --routines --triggers --events ${q(d.mariadb_database)}`,
    restore: (d) => `mariadb -uroot -p${q(d.mariadb_root_password)} ${q(d.mariadb_database)}`,
    count: (d) => `mariadb -uroot -p${q(d.mariadb_root_password)} ${q(d.mariadb_database)} -N -e "select count(*) from information_schema.tables where table_schema=database()"`,
  },
  "standalone-mongodb": {
    path: "mongodb", ids: ["mongo_initdb_root_username", "mongo_initdb_database"], pws: ["mongo_initdb_root_password"], extra: [],
    ready: (d) => `mongosh --quiet -u ${q(d.mongo_initdb_root_username)} -p ${q(d.mongo_initdb_root_password)} --authenticationDatabase admin --eval "db.runCommand({ping:1}).ok" | grep -q 1`,
    dump: (d) => `mongodump --quiet --archive -u ${q(d.mongo_initdb_root_username)} -p ${q(d.mongo_initdb_root_password)} --authenticationDatabase admin`,
    restore: (d, s) => `mongorestore --quiet --archive --drop -u ${q(d.mongo_initdb_root_username)} -p ${q(d.mongo_initdb_root_password)} --authenticationDatabase admin` +
      (s.mongo_initdb_database && s.mongo_initdb_database !== d.mongo_initdb_database ? ` --nsFrom ${q(s.mongo_initdb_database + ".*")} --nsTo ${q(d.mongo_initdb_database + ".*")}` : ""),
    count: (d) => `mongosh --quiet -u ${q(d.mongo_initdb_root_username)} -p ${q(d.mongo_initdb_root_password)} --authenticationDatabase admin --eval "db.adminCommand('listDatabases').databases.filter(x=>!['admin','config','local'].includes(x.name)).length"`,
  },
  "standalone-redis": {
    path: "redis", ids: [], pws: ["redis_password"], extra: [],
    ready: (d) => `redis-cli -a ${q(d.redis_password)} --no-auth-warning ping | grep -q PONG`,
    // Snapshot copy. Coolify starts redis with --appendonly yes and Redis 7 ignores dump.rdb in that mode (starts empty).
    // So the snapshot is installed as the base file of a multi-part AOF (manifest + base.rdb), and also as dump.rdb for
    // appendonly=off. Either mode loads it on restart; the count check confirms. Writes after SAVE are lost.
    dump: (d) => `sh -c "redis-cli -a ${q(d.redis_password)} --no-auth-warning save >/dev/null && cat /data/dump.rdb"`,
    restore: () => `sh -c "rm -rf /data/appendonlydir && mkdir -p /data/appendonlydir && cat > /data/appendonlydir/appendonly.aof.1.base.rdb && printf 'file appendonly.aof.1.base.rdb seq 1 type b\\n' > /data/appendonlydir/appendonly.aof.manifest && cp /data/appendonlydir/appendonly.aof.1.base.rdb /data/dump.rdb"`,
    after: () => `docker restart {uuid} >/dev/null && sleep 5`,
    count: (d) => `redis-cli -a ${q(d.redis_password)} --no-auth-warning dbsize`,
  },
};
