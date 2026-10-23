import ts from "typescript";
import { readFile, writeFile } from "node:fs/promises";

const source = ts.createSourceFile(
  "api.ts",
  await readFile("server/api.ts", "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
const queries = new Set();
function visit(node) {
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "prepare"
  ) {
    const argument = node.arguments[0];
    if (
      !ts.isStringLiteral(argument) &&
      !ts.isNoSubstitutionTemplateLiteral(argument)
    )
      throw new Error("Account queries must be fixed SQL statements.");
    queries.add(argument.text.replace(/\s+/g, " ").trim());
  }
  ts.forEachChild(node, visit);
}
visit(source);
const queryFunction = `
create or replace function public.media_queries(statements jsonb) returns jsonb
language plpgsql security definer set search_path = media_thingy, pg_catalog as $function$
declare
  allowed_sql constant jsonb := $queries$${JSON.stringify([...queries], null, 2)}$queries$::jsonb;
  statement jsonb; original_sql text; translated_sql text; expanded_sql text;
  parts text[]; i integer; rows jsonb; affected bigint; results jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(statements) <> 'array' or jsonb_array_length(statements) not between 1 and 20 then
    raise exception 'Invalid query batch';
  end if;
  for statement in select value from jsonb_array_elements(statements) loop
    original_sql := statement->>'sql';
    if original_sql is null or not (allowed_sql ? original_sql) then raise exception 'Query is not allowed'; end if;
    translated_sql := replace(original_sql, 'username = ? COLLATE NOCASE', 'lower(username) = lower(?)');
    translated_sql := replace(translated_sql, 'MAX(0,', 'GREATEST(0,');
    parts := string_to_array(translated_sql, '?');
    if jsonb_typeof(statement->'params') <> 'array' or jsonb_array_length(statement->'params') <> cardinality(parts) - 1 then
      raise exception 'Invalid query arguments';
    end if;
    expanded_sql := parts[1];
    for i in 1..cardinality(parts) - 1 loop
      expanded_sql := expanded_sql || format('%L', statement->'params'->>(i - 1)) || parts[i + 1];
    end loop;
    if original_sql like 'SELECT %' then
      execute 'select coalesce(jsonb_agg(to_jsonb(q)), ''[]''::jsonb) from (' || expanded_sql || ') q' into rows;
      affected := 0;
    elsif original_sql like '% RETURNING %' then
      execute 'with q as (' || expanded_sql || ') select coalesce(jsonb_agg(to_jsonb(q)), ''[]''::jsonb) from q' into rows;
      affected := jsonb_array_length(rows);
    else
      execute expanded_sql;
      get diagnostics affected = row_count;
      rows := '[]'::jsonb;
    end if;
    results := results || jsonb_build_array(jsonb_build_object('results', rows, 'meta', jsonb_build_object('changes', affected)));
  end loop;
  return results;
end;
$function$;
revoke all on function public.media_queries(jsonb) from public, anon, authenticated;
grant execute on function public.media_queries(jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
`;
const sql = (await readFile("supabase/schema.sql", "utf8")) + queryFunction;
const path = "public/setup-supabase.sql";
if (process.argv.includes("--check")) {
  if ((await readFile(path, "utf8")) !== sql)
    throw new Error(
      "Supabase setup is outdated. Run npm run generate:supabase and commit the result.",
    );
} else {
  await writeFile(path, sql);
  console.log(
    `Generated ${path} with ${queries.size} allowed account queries.`,
  );
}
