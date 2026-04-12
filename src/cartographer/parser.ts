import Parser from "tree-sitter";
import type { ParsedFile, ParsedSymbol } from "../types/cartographer.js";
import type { SymbolDetail } from "../types/substrate.js";
import { readFileSync } from "node:fs";
import { createLogger } from "../util/logger.js";

const log = createLogger("cartographer");

// Language grammars loaded on demand
const grammarCache = new Map<string, any>();

const LANGUAGE_MAP: Record<string, string> = {
  typescript: "tree-sitter-typescript/typescript",
  tsx: "tree-sitter-typescript/tsx",
  javascript: "tree-sitter-javascript",
  python: "tree-sitter-python",
  go: "tree-sitter-go",
  rust: "tree-sitter-rust",
  java: "tree-sitter-java",
  c: "tree-sitter-c",
};

const EXTENSION_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".c": "c",
  ".h": "c",
  ".cpp": "c",
  ".cc": "c",
  ".hpp": "c",
};

export function detectLanguage(filePath: string): string | null {
  const ext = filePath.slice(filePath.lastIndexOf("."));
  return EXTENSION_MAP[ext] ?? null;
}

async function getGrammar(language: string): Promise<any> {
  const cached = grammarCache.get(language);
  if (cached) return cached;

  const modulePath = LANGUAGE_MAP[language];
  if (!modulePath) return null;

  try {
    const mod = await import(modulePath);
    const grammar = mod.default ?? mod;
    grammarCache.set(language, grammar);
    return grammar;
  } catch (error) {
    log.warn({ language, error }, "Failed to load grammar");
    return null;
  }
}

/**
 * Parse a single file and extract symbols.
 */
export async function parseFile(filePath: string): Promise<ParsedFile | null> {
  const language = detectLanguage(filePath);
  if (!language) return null;

  const grammar = await getGrammar(language);
  if (!grammar) return null;

  let source: string;
  try {
    source = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const parser = new Parser();
  parser.setLanguage(grammar);
  const tree = parser.parse(source);

  const symbols: ParsedSymbol[] = [];
  const imports: string[] = [];
  const exports: string[] = [];

  extractSymbols(tree.rootNode, language, symbols, imports, exports);

  const loc = source.split("\n").length;
  const complexityScore = computeComplexity(tree.rootNode, loc);

  return {
    filePath,
    language,
    symbols,
    imports,
    exports,
    loc,
    complexityScore,
  };
}

function extractSymbols(
  node: Parser.SyntaxNode,
  language: string,
  symbols: ParsedSymbol[],
  imports: string[],
  exports: string[],
): void {
  switch (language) {
    case "typescript":
    case "tsx":
    case "javascript":
      extractJsTsSymbols(node, symbols, imports, exports);
      break;
    case "python":
      extractPythonSymbols(node, symbols, imports, exports);
      break;
    case "go":
      extractGoSymbols(node, symbols, imports, exports);
      break;
    case "rust":
      extractRustSymbols(node, symbols, imports, exports);
      break;
    case "java":
      extractJavaSymbols(node, symbols, imports, exports);
      break;
    case "c":
      extractCSymbols(node, symbols, imports, exports);
      break;
  }
}

// --- Language-specific extractors ---

function extractJsTsSymbols(
  node: Parser.SyntaxNode,
  symbols: ParsedSymbol[],
  imports: string[],
  exports: string[],
): void {
  for (const child of node.children) {
    switch (child.type) {
      case "function_declaration":
      case "generator_function_declaration": {
        const name = child.childForFieldName("name")?.text ?? "";
        if (name) {
          symbols.push(makeSymbol(name, "function", child));
        }
        break;
      }
      case "class_declaration": {
        const name = child.childForFieldName("name")?.text ?? "";
        if (name) {
          const sym = makeSymbol(name, "class", child);
          sym.children = extractClassMembers(child);
          symbols.push(sym);
        }
        break;
      }
      case "interface_declaration": {
        const name = child.childForFieldName("name")?.text ?? "";
        if (name) symbols.push(makeSymbol(name, "interface", child));
        break;
      }
      case "type_alias_declaration": {
        const name = child.childForFieldName("name")?.text ?? "";
        if (name) symbols.push(makeSymbol(name, "type", child));
        break;
      }
      case "enum_declaration": {
        const name = child.childForFieldName("name")?.text ?? "";
        if (name) symbols.push(makeSymbol(name, "enum", child));
        break;
      }
      case "lexical_declaration":
      case "variable_declaration": {
        for (const decl of child.children) {
          if (decl.type === "variable_declarator") {
            const name = decl.childForFieldName("name")?.text ?? "";
            const value = decl.childForFieldName("value");
            const kind: SymbolDetail["kind"] =
              value?.type === "arrow_function" || value?.type === "function"
                ? "function"
                : "variable";
            if (name) symbols.push(makeSymbol(name, kind, child));
          }
        }
        break;
      }
      case "import_statement": {
        const source = child.childForFieldName("source")?.text?.replace(/['"]/g, "");
        if (source) imports.push(source);
        break;
      }
      case "export_statement": {
        const declaration = child.childForFieldName("declaration");
        if (declaration) {
          const name =
            declaration.childForFieldName("name")?.text ??
            declaration.children.find((c) => c.type === "variable_declarator")
              ?.childForFieldName("name")?.text;
          if (name) exports.push(name);
        }
        // Recurse into the export to catch its declarations
        extractJsTsSymbols(child, symbols, imports, exports);
        break;
      }
    }
  }
}

function extractPythonSymbols(
  node: Parser.SyntaxNode,
  symbols: ParsedSymbol[],
  imports: string[],
  exports: string[],
): void {
  for (const child of node.children) {
    switch (child.type) {
      case "function_definition": {
        const name = child.childForFieldName("name")?.text ?? "";
        if (name) symbols.push(makeSymbol(name, "function", child));
        break;
      }
      case "class_definition": {
        const name = child.childForFieldName("name")?.text ?? "";
        if (name) {
          const sym = makeSymbol(name, "class", child);
          sym.children = extractPythonClassMembers(child);
          symbols.push(sym);
        }
        break;
      }
      case "import_statement":
      case "import_from_statement": {
        imports.push(child.text);
        break;
      }
      case "decorated_definition": {
        extractPythonSymbols(child, symbols, imports, exports);
        break;
      }
    }
  }
}

function extractGoSymbols(
  node: Parser.SyntaxNode,
  symbols: ParsedSymbol[],
  imports: string[],
  exports: string[],
): void {
  for (const child of node.children) {
    switch (child.type) {
      case "function_declaration": {
        const name = child.childForFieldName("name")?.text ?? "";
        if (name) {
          symbols.push(makeSymbol(name, "function", child));
          if (name[0] === name[0]?.toUpperCase()) exports.push(name);
        }
        break;
      }
      case "method_declaration": {
        const name = child.childForFieldName("name")?.text ?? "";
        if (name) symbols.push(makeSymbol(name, "method", child));
        break;
      }
      case "type_declaration": {
        for (const spec of child.children) {
          if (spec.type === "type_spec") {
            const name = spec.childForFieldName("name")?.text ?? "";
            const typeNode = spec.childForFieldName("type");
            const kind: SymbolDetail["kind"] =
              typeNode?.type === "struct_type"
                ? "struct"
                : typeNode?.type === "interface_type"
                  ? "interface"
                  : "type";
            if (name) {
              symbols.push(makeSymbol(name, kind, spec));
              if (name[0] === name[0]?.toUpperCase()) exports.push(name);
            }
          }
        }
        break;
      }
      case "import_declaration": {
        imports.push(child.text);
        break;
      }
    }
  }
}

function extractRustSymbols(
  node: Parser.SyntaxNode,
  symbols: ParsedSymbol[],
  imports: string[],
  exports: string[],
): void {
  for (const child of node.children) {
    switch (child.type) {
      case "function_item": {
        const name = child.childForFieldName("name")?.text ?? "";
        if (name) symbols.push(makeSymbol(name, "function", child));
        break;
      }
      case "struct_item": {
        const name = child.childForFieldName("name")?.text ?? "";
        if (name) symbols.push(makeSymbol(name, "struct", child));
        break;
      }
      case "enum_item": {
        const name = child.childForFieldName("name")?.text ?? "";
        if (name) symbols.push(makeSymbol(name, "enum", child));
        break;
      }
      case "trait_item": {
        const name = child.childForFieldName("name")?.text ?? "";
        if (name) symbols.push(makeSymbol(name, "trait", child));
        break;
      }
      case "impl_item": {
        // Extract methods from impl blocks
        const body = child.childForFieldName("body");
        if (body) {
          for (const member of body.children) {
            if (member.type === "function_item") {
              const name = member.childForFieldName("name")?.text ?? "";
              if (name) symbols.push(makeSymbol(name, "method", member));
            }
          }
        }
        break;
      }
      case "use_declaration": {
        imports.push(child.text);
        break;
      }
    }
  }
}

function extractJavaSymbols(
  node: Parser.SyntaxNode,
  symbols: ParsedSymbol[],
  imports: string[],
  exports: string[],
): void {
  for (const child of node.children) {
    switch (child.type) {
      case "class_declaration": {
        const name = child.childForFieldName("name")?.text ?? "";
        if (name) {
          const sym = makeSymbol(name, "class", child);
          sym.children = extractJavaMembers(child);
          symbols.push(sym);
        }
        break;
      }
      case "interface_declaration": {
        const name = child.childForFieldName("name")?.text ?? "";
        if (name) symbols.push(makeSymbol(name, "interface", child));
        break;
      }
      case "enum_declaration": {
        const name = child.childForFieldName("name")?.text ?? "";
        if (name) symbols.push(makeSymbol(name, "enum", child));
        break;
      }
      case "import_declaration": {
        imports.push(child.text);
        break;
      }
    }
  }
}

function extractCSymbols(
  node: Parser.SyntaxNode,
  symbols: ParsedSymbol[],
  imports: string[],
  exports: string[],
): void {
  for (const child of node.children) {
    switch (child.type) {
      case "function_definition": {
        const declarator = child.childForFieldName("declarator");
        const name = declarator?.childForFieldName("declarator")?.text ?? "";
        if (name) symbols.push(makeSymbol(name, "function", child));
        break;
      }
      case "struct_specifier": {
        const name = child.childForFieldName("name")?.text ?? "";
        if (name) symbols.push(makeSymbol(name, "struct", child));
        break;
      }
      case "enum_specifier": {
        const name = child.childForFieldName("name")?.text ?? "";
        if (name) symbols.push(makeSymbol(name, "enum", child));
        break;
      }
      case "preproc_include": {
        imports.push(child.text);
        break;
      }
    }
  }
}

// --- Helpers ---

function makeSymbol(
  name: string,
  kind: SymbolDetail["kind"],
  node: Parser.SyntaxNode,
): ParsedSymbol {
  // Try to extract a docstring from the previous sibling
  const prev = node.previousNamedSibling;
  const docstring =
    prev?.type === "comment" ? prev.text : undefined;

  // Build a signature from the first line
  const firstLine = node.text.split("\n")[0] ?? "";
  const signature =
    firstLine.length > 200 ? firstLine.slice(0, 200) + "..." : firstLine;

  return {
    name,
    kind,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    signature,
    docstring,
  };
}

function extractClassMembers(node: Parser.SyntaxNode): ParsedSymbol[] {
  const members: ParsedSymbol[] = [];
  const body = node.childForFieldName("body");
  if (!body) return members;

  for (const child of body.children) {
    if (child.type === "method_definition" || child.type === "public_field_definition") {
      const name = child.childForFieldName("name")?.text ?? "";
      if (name) members.push(makeSymbol(name, "method", child));
    }
  }
  return members;
}

function extractPythonClassMembers(node: Parser.SyntaxNode): ParsedSymbol[] {
  const members: ParsedSymbol[] = [];
  const body = node.childForFieldName("body");
  if (!body) return members;

  for (const child of body.children) {
    if (child.type === "function_definition") {
      const name = child.childForFieldName("name")?.text ?? "";
      if (name) members.push(makeSymbol(name, "method", child));
    }
  }
  return members;
}

function extractJavaMembers(node: Parser.SyntaxNode): ParsedSymbol[] {
  const members: ParsedSymbol[] = [];
  const body = node.childForFieldName("body");
  if (!body) return members;

  for (const child of body.children) {
    if (child.type === "method_declaration") {
      const name = child.childForFieldName("name")?.text ?? "";
      if (name) members.push(makeSymbol(name, "method", child));
    }
  }
  return members;
}

/**
 * Compute a normalized complexity score based on branching and nesting.
 */
function computeComplexity(root: Parser.SyntaxNode, loc: number): number {
  let branches = 0;
  const complexityNodeTypes = new Set([
    "if_statement",
    "for_statement",
    "while_statement",
    "switch_statement",
    "try_statement",
    "catch_clause",
    "ternary_expression",
    "conditional_expression",
    "match_expression",
    "match_arm",
  ]);

  function walk(node: Parser.SyntaxNode) {
    if (complexityNodeTypes.has(node.type)) branches++;
    for (const child of node.children) walk(child);
  }
  walk(root);

  // Normalize: branches per 100 LOC, capped at 1.0
  const branchDensity = loc > 0 ? branches / (loc / 100) : 0;
  return Math.min(1.0, branchDensity / 20);
}
