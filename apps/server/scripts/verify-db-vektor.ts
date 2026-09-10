/**
 * F265.x — KAN PROD-DATABASEN SELV REGNE VEKTOR-AFSTAND?
 * Målt mod den RIGTIGE sqld-server, ikke mod en lokal fil.
 */
import { createLibsqlDatabase } from '@trail/db';
const url = process.env.PROBE_DB_URL!;
const db = await createLibsqlDatabase({ url } as never);
for (const [navn, sql] of [
  ['vector32 + distance', `SELECT vector_distance_cos(vector32('[1,2,3]'), vector32('[1,2,4]')) AS d`],
  ['vector_extract',      `SELECT vector_extract(vector32('[1,2]')) AS v`],
  ['på RIGTIGE vektorer', `SELECT COUNT(*) AS n FROM chunk_embeddings`],
] as const) {
  try {
    const r = await db.execute(sql, []);
    console.log(`  ${navn}: JA  ${JSON.stringify(r.rows[0])}`);
  } catch (e) {
    console.log(`  ${navn}: NEJ  ${e instanceof Error ? e.message.slice(0,90) : e}`);
  }
}
