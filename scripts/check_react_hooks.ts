import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";

/**
 * Validator React Rules of Hooks Berbasis AST TypeScript
 * Memastikan tidak ada Hook yang dipanggil setelah early return/throw atau di dalam struktur kondisional/loop.
 */
function findFiles(dir: string, ext: string[]): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(findFiles(fullPath, ext));
    } else if (ext.some((e) => fullPath.endsWith(e))) {
      results.push(fullPath);
    }
  }
  return results;
}

const files = findFiles("./app/src", [".tsx", ".ts"]);
let totalViolations = 0;

for (const filePath of files) {
  const content = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);

  function checkFunctionBody(body: ts.Node, fnName: string) {
    let returnSeen = false;
    let returnLine = 0;

    if (ts.isBlock(body)) {
      for (const stmt of body.statements) {
        if (ts.isIfStatement(stmt)) {
          function hasReturnOrThrow(n: ts.Node): boolean {
            if (ts.isReturnStatement(n) || ts.isThrowStatement(n)) return true;
            if (ts.isBlock(n)) return n.statements.some(hasReturnOrThrow);
            return false;
          }
          if (
            hasReturnOrThrow(stmt.thenStatement) ||
            (stmt.elseStatement && hasReturnOrThrow(stmt.elseStatement))
          ) {
            returnSeen = true;
            returnLine = sourceFile.getLineAndCharacterOfPosition(stmt.getStart()).line + 1;
          }
        } else if (ts.isReturnStatement(stmt) || ts.isThrowStatement(stmt)) {
          returnSeen = true;
          returnLine = sourceFile.getLineAndCharacterOfPosition(stmt.getStart()).line + 1;
        }

        function findHooks(n: ts.Node, inConditional: boolean) {
          if (
            ts.isFunctionDeclaration(n) ||
            ts.isArrowFunction(n) ||
            ts.isFunctionExpression(n)
          ) {
            return;
          }

          const isCond =
            inConditional ||
            ts.isIfStatement(n) ||
            ts.isConditionalExpression(n) ||
            ts.isForStatement(n) ||
            ts.isForOfStatement(n) ||
            ts.isForInStatement(n) ||
            ts.isWhileStatement(n) ||
            ts.isDoStatement(n) ||
            ts.isCaseClause(n);

          if (ts.isCallExpression(n)) {
            const expr = n.expression;
            let callName = "";
            if (ts.isIdentifier(expr)) callName = expr.text;
            else if (ts.isPropertyAccessExpression(expr)) callName = expr.name.text;

            if (/^use[A-Z]/.test(callName)) {
              const hookLine = sourceFile.getLineAndCharacterOfPosition(n.getStart()).line + 1;
              if (returnSeen) {
                console.error(
                  `❌ [Rules of Hooks] Pelanggaran di ${filePath}:${hookLine}: Hook "${callName}" dipanggil setelah early return/throw pada baris ${returnLine} di "${fnName}".`
                );
                totalViolations++;
              }
              if (isCond) {
                console.error(
                  `❌ [Rules of Hooks] Pelanggaran di ${filePath}:${hookLine}: Hook "${callName}" dipanggil di dalam struktur kondisional/loop di "${fnName}".`
                );
                totalViolations++;
              }
            }
          }
          ts.forEachChild(n, (child) => findHooks(child, isCond));
        }

        findHooks(stmt, false);
      }
    }
  }

  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.body) {
      checkFunctionBody(node.body, node.name ? node.name.text : "anonymous");
    } else if (ts.isFunctionExpression(node) && node.body) {
      checkFunctionBody(node.body, node.name ? node.name.text : "anonymous");
    } else if (ts.isArrowFunction(node) && ts.isBlock(node.body)) {
      checkFunctionBody(node.body, "arrow");
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

if (totalViolations > 0) {
  console.error(`\n❌ Total pelanggaran Rules of Hooks: ${totalViolations}`);
  process.exit(1);
} else {
  console.log(`✅ Pemeriksaan React Rules of Hooks berhasil (${files.length} berkas di app/src/ bersih 100%).`);
  process.exit(0);
}

