import "dotenv/config";
import { readFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const files = [
  join(root, "sql", "01_init_extensions.sql"),
  join(root, "sql", "02_schema.sql"),
  join(root, "sql", "03_seed_network.sql"),
];

async function main() {
  const client = new pg.Client({
    user: process.env.DB_USER ?? "postgres",
    host: process.env.DB_HOST ?? "localhost",
    port: Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_DATABASE ?? "ems_pgrouting",
    password: process.env.DB_PASSWORD,
  });

  await client.connect();
  console.log(`Connected to ${process.env.DB_DATABASE ?? "ems_pgrouting"}`);

  for (const file of files) {
    const sql = await readFile(file, "utf8");
    console.log(`Running ${file} ...`);
    await client.query(sql);
  }

  await client.end();
  console.log("Road network reload complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
