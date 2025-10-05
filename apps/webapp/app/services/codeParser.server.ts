import Parser from "web-tree-sitter";
import { logger } from "./logger.service";

// Parser initialization state
let isInitialized = false;
let parsers: Map<string, Parser> = new Map();

// Language file mappings
const LANGUAGE_GRAMMARS: Record<string, string> = {
  typescript: "tree-sitter-typescript.wasm",
  javascript: "tree-sitter-javascript.wasm",
  python: "tree-sitter-python.wasm",
  go: "tree-sitter-go.wasm",
  tsx: "tree-sitter-tsx.wasm",
  jsx: "tree-sitter-javascript.wasm",
};

// Detect language from file extension
export function detectLanguage(filePath: string): string | null {
  const ext = filePath.split(".").pop()?.toLowerCase();

  switch (ext) {
    case "ts":
      return "typescript";
    case "tsx":
      return "tsx";
    case "js":
      return "javascript";
    case "jsx":
      return "jsx";
    case "py":
      return "python";
    case "go":
      return "go";
    default:
      return null;
  }
}

/**
 * Initialize tree-sitter parsers for supported languages
 */
export async function initializeParsers(): Promise<void> {
  if (isInitialized) {
    return;
  }

  try {
    await Parser.init();

    // Initialize parsers for each language
    for (const [lang, grammarFile] of Object.entries(LANGUAGE_GRAMMARS)) {
      try {
        const parser = new Parser();
        const langPath = `/tree-sitter/${grammarFile}`;
        const Language = await Parser.Language.load(langPath);
        parser.setLanguage(Language);
        parsers.set(lang, parser);
        logger.log(`Initialized ${lang} parser`);
      } catch (err) {
        logger.warn(`Failed to initialize ${lang} parser:`, err);
      }
    }

    isInitialized = true;
    logger.log("Tree-sitter parsers initialized");
  } catch (err) {
    logger.error("Failed to initialize tree-sitter:", err);
    throw err;
  }
}

/**
 * Parse source code to AST
 */
export async function parseCode(
  sourceCode: string,
  language: string
): Promise<Parser.Tree | null> {
  if (!isInitialized) {
    await initializeParsers();
  }

  const parser = parsers.get(language);
  if (!parser) {
    logger.warn(`No parser available for language: ${language}`);
    return null;
  }

  try {
    const tree = parser.parse(sourceCode);
    return tree;
  } catch (err) {
    logger.error(`Failed to parse code (${language}):`, err);
    return null;
  }
}

/**
 * Parse a file and return its AST
 */
export async function parseFile(
  filePath: string,
  sourceCode: string
): Promise<{ tree: Parser.Tree; language: string } | null> {
  const language = detectLanguage(filePath);

  if (!language) {
    logger.warn(`Unsupported file type: ${filePath}`);
    return null;
  }

  const tree = await parseCode(sourceCode, language);

  if (!tree) {
    return null;
  }

  return { tree, language };
}

/**
 * Get node text from source code
 */
export function getNodeText(node: Parser.SyntaxNode, sourceCode: string): string {
  return sourceCode.substring(node.startIndex, node.endIndex);
}

/**
 * Walk AST and execute callback for each node
 */
export function walkTree(
  node: Parser.SyntaxNode,
  callback: (node: Parser.SyntaxNode) => void | boolean
): void {
  const shouldContinue = callback(node);

  // If callback returns false, stop traversal
  if (shouldContinue === false) {
    return;
  }

  for (const child of node.children) {
    walkTree(child, callback);
  }
}

/**
 * Find all nodes of a specific type
 */
export function findNodesByType(
  tree: Parser.Tree,
  nodeType: string
): Parser.SyntaxNode[] {
  const nodes: Parser.SyntaxNode[] = [];

  walkTree(tree.rootNode, (node) => {
    if (node.type === nodeType) {
      nodes.push(node);
    }
  });

  return nodes;
}

/**
 * Get node location (line and column)
 */
export function getNodeLocation(node: Parser.SyntaxNode): {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
} {
  return {
    startLine: node.startPosition.row + 1, // 1-indexed
    startColumn: node.startPosition.column,
    endLine: node.endPosition.row + 1,
    endColumn: node.endPosition.column,
  };
}
