import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

export const db = drizzle(neon(getEnv().DATABASE_URL), { schema });

export type Database = typeof db;
