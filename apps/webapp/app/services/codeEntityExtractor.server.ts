import Parser from "web-tree-sitter";
import { getNodeText, getNodeLocation, walkTree } from "./codeParser.server";
import crypto from "crypto";

export interface ExtractedFunction {
  uuid: string;
  name: string;
  params: string[];
  returnType?: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  isAsync: boolean;
  isExport: boolean;
  docstring?: string;
}

export interface ExtractedClass {
  uuid: string;
  name: string;
  extends?: string;
  implements?: string[];
  methods: string[]; // Function UUIDs
  properties: string[];
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  isExport: boolean;
  docstring?: string;
}

export interface ExtractedImport {
  uuid: string;
  source: string;
  imports: string[]; // imported names
  isDefault: boolean;
  line: number;
}

export interface CodeEntities {
  functions: ExtractedFunction[];
  classes: ExtractedClass[];
  imports: ExtractedImport[];
}

/**
 * Extract entities from TypeScript/JavaScript AST
 */
export function extractTypeScriptEntities(
  tree: Parser.Tree,
  sourceCode: string
): CodeEntities {
  const functions: ExtractedFunction[] = [];
  const classes: ExtractedClass[] = [];
  const imports: ExtractedImport[] = [];

  walkTree(tree.rootNode, (node) => {
    // Extract function declarations
    if (
      node.type === "function_declaration" ||
      node.type === "method_definition" ||
      node.type === "arrow_function" ||
      node.type === "function_expression"
    ) {
      const func = extractFunction(node, sourceCode);
      if (func) {
        functions.push(func);
      }
    }

    // Extract class declarations
    if (node.type === "class_declaration") {
      const cls = extractClass(node, sourceCode);
      if (cls) {
        classes.push(cls);
      }
    }

    // Extract imports
    if (node.type === "import_statement") {
      const imp = extractImport(node, sourceCode);
      if (imp) {
        imports.push(imp);
      }
    }
  });

  return { functions, classes, imports };
}

/**
 * Extract entities from Python AST
 */
export function extractPythonEntities(
  tree: Parser.Tree,
  sourceCode: string
): CodeEntities {
  const functions: ExtractedFunction[] = [];
  const classes: ExtractedClass[] = [];
  const imports: ExtractedImport[] = [];

  walkTree(tree.rootNode, (node) => {
    // Extract function definitions
    if (node.type === "function_definition") {
      const func = extractPythonFunction(node, sourceCode);
      if (func) {
        functions.push(func);
      }
    }

    // Extract class definitions
    if (node.type === "class_definition") {
      const cls = extractPythonClass(node, sourceCode);
      if (cls) {
        classes.push(cls);
      }
    }

    // Extract imports
    if (node.type === "import_statement" || node.type === "import_from_statement") {
      const imp = extractPythonImport(node, sourceCode);
      if (imp) {
        imports.push(imp);
      }
    }
  });

  return { functions, classes, imports };
}

/**
 * Extract entities from Go AST
 */
export function extractGoEntities(
  tree: Parser.Tree,
  sourceCode: string
): CodeEntities {
  const functions: ExtractedFunction[] = [];
  const classes: ExtractedClass[] = [];
  const imports: ExtractedImport[] = [];

  walkTree(tree.rootNode, (node) => {
    // Extract function declarations
    if (node.type === "function_declaration" || node.type === "method_declaration") {
      const func = extractGoFunction(node, sourceCode);
      if (func) {
        functions.push(func);
      }
    }

    // Extract type definitions (Go's version of classes/structs)
    if (node.type === "type_declaration") {
      const cls = extractGoType(node, sourceCode);
      if (cls) {
        classes.push(cls);
      }
    }

    // Extract imports
    if (node.type === "import_declaration") {
      const imp = extractGoImport(node, sourceCode);
      if (imp) {
        imports.push(imp);
      }
    }
  });

  return { functions, classes, imports };
}

/**
 * Extract function from TypeScript/JavaScript node
 */
function extractFunction(node: Parser.SyntaxNode, sourceCode: string): ExtractedFunction | null {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return null;

  const name = getNodeText(nameNode, sourceCode);
  const location = getNodeLocation(node);

  // Extract parameters
  const params: string[] = [];
  const paramsNode = node.childForFieldName("parameters");
  if (paramsNode) {
    for (const param of paramsNode.children) {
      if (param.type === "required_parameter" || param.type === "optional_parameter") {
        const paramName = param.childForFieldName("pattern");
        if (paramName) {
          params.push(getNodeText(paramName, sourceCode));
        }
      }
    }
  }

  // Extract return type
  const returnTypeNode = node.childForFieldName("return_type");
  const returnType = returnTypeNode ? getNodeText(returnTypeNode, sourceCode) : undefined;

  // Check if async
  const isAsync = node.children.some((child) => child.type === "async");

  // Check if exported
  const parent = node.parent;
  const isExport = parent?.type === "export_statement" || parent?.type === "export";

  return {
    uuid: crypto.randomUUID(),
    name,
    params,
    returnType,
    startLine: location.startLine,
    endLine: location.endLine,
    startColumn: location.startColumn,
    endColumn: location.endColumn,
    isAsync,
    isExport,
  };
}

/**
 * Extract class from TypeScript/JavaScript node
 */
function extractClass(node: Parser.SyntaxNode, sourceCode: string): ExtractedClass | null {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return null;

  const name = getNodeText(nameNode, sourceCode);
  const location = getNodeLocation(node);

  // Extract extends
  const heritageNode = node.children.find((child) => child.type === "class_heritage");
  let extendsClass: string | undefined;
  if (heritageNode) {
    const extendsNode = heritageNode.children.find((child) => child.type === "extends_clause");
    if (extendsNode) {
      const typeNode = extendsNode.children.find((child) => child.type !== "extends");
      if (typeNode) {
        extendsClass = getNodeText(typeNode, sourceCode);
      }
    }
  }

  // Extract methods and properties
  const methods: string[] = [];
  const properties: string[] = [];
  const bodyNode = node.childForFieldName("body");
  if (bodyNode) {
    for (const member of bodyNode.children) {
      if (member.type === "method_definition") {
        const methodNameNode = member.childForFieldName("name");
        if (methodNameNode) {
          methods.push(getNodeText(methodNameNode, sourceCode));
        }
      } else if (member.type === "field_definition" || member.type === "public_field_definition") {
        const propNameNode = member.childForFieldName("property");
        if (propNameNode) {
          properties.push(getNodeText(propNameNode, sourceCode));
        }
      }
    }
  }

  // Check if exported
  const parent = node.parent;
  const isExport = parent?.type === "export_statement";

  return {
    uuid: crypto.randomUUID(),
    name,
    extends: extendsClass,
    methods,
    properties,
    startLine: location.startLine,
    endLine: location.endLine,
    startColumn: location.startColumn,
    endColumn: location.endColumn,
    isExport,
  };
}

/**
 * Extract import from TypeScript/JavaScript node
 */
function extractImport(node: Parser.SyntaxNode, sourceCode: string): ExtractedImport | null {
  const sourceNode = node.childForFieldName("source");
  if (!sourceNode) return null;

  const source = getNodeText(sourceNode, sourceCode).replace(/['"]/g, "");
  const location = getNodeLocation(node);

  // Extract imported names
  const imports: string[] = [];
  let isDefault = false;

  const importClauseNode = node.children.find(
    (child) => child.type === "import_clause" || child.type === "named_imports"
  );

  if (importClauseNode) {
    for (const child of importClauseNode.children) {
      if (child.type === "identifier") {
        imports.push(getNodeText(child, sourceCode));
        isDefault = true;
      } else if (child.type === "named_imports") {
        for (const specifier of child.children) {
          if (specifier.type === "import_specifier") {
            const nameNode = specifier.childForFieldName("name");
            if (nameNode) {
              imports.push(getNodeText(nameNode, sourceCode));
            }
          }
        }
      }
    }
  }

  return {
    uuid: crypto.randomUUID(),
    source,
    imports,
    isDefault,
    line: location.startLine,
  };
}

/**
 * Extract function from Python node
 */
function extractPythonFunction(node: Parser.SyntaxNode, sourceCode: string): ExtractedFunction | null {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return null;

  const name = getNodeText(nameNode, sourceCode);
  const location = getNodeLocation(node);

  // Extract parameters
  const params: string[] = [];
  const paramsNode = node.childForFieldName("parameters");
  if (paramsNode) {
    for (const param of paramsNode.children) {
      if (param.type === "identifier") {
        params.push(getNodeText(param, sourceCode));
      }
    }
  }

  // Check if async
  const isAsync = node.children.some((child) => child.type === "async");

  return {
    uuid: crypto.randomUUID(),
    name,
    params,
    startLine: location.startLine,
    endLine: location.endLine,
    startColumn: location.startColumn,
    endColumn: location.endColumn,
    isAsync,
    isExport: false, // Python doesn't have explicit exports
  };
}

/**
 * Extract class from Python node
 */
function extractPythonClass(node: Parser.SyntaxNode, sourceCode: string): ExtractedClass | null {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return null;

  const name = getNodeText(nameNode, sourceCode);
  const location = getNodeLocation(node);

  // Extract base classes
  const superclassNode = node.childForFieldName("superclasses");
  let extendsClass: string | undefined;
  if (superclassNode && superclassNode.children.length > 0) {
    const firstBase = superclassNode.children.find((child) => child.type === "identifier");
    if (firstBase) {
      extendsClass = getNodeText(firstBase, sourceCode);
    }
  }

  // Extract methods
  const methods: string[] = [];
  const bodyNode = node.childForFieldName("body");
  if (bodyNode) {
    for (const child of bodyNode.children) {
      if (child.type === "function_definition") {
        const methodNameNode = child.childForFieldName("name");
        if (methodNameNode) {
          methods.push(getNodeText(methodNameNode, sourceCode));
        }
      }
    }
  }

  return {
    uuid: crypto.randomUUID(),
    name,
    extends: extendsClass,
    methods,
    properties: [],
    startLine: location.startLine,
    endLine: location.endLine,
    startColumn: location.startColumn,
    endColumn: location.endColumn,
    isExport: false,
  };
}

/**
 * Extract import from Python node
 */
function extractPythonImport(node: Parser.SyntaxNode, sourceCode: string): ExtractedImport | null {
  const location = getNodeLocation(node);
  const imports: string[] = [];
  let source = "";

  if (node.type === "import_statement") {
    // import module
    const nameNode = node.childForFieldName("name");
    if (nameNode) {
      source = getNodeText(nameNode, sourceCode);
      imports.push(source);
    }
  } else if (node.type === "import_from_statement") {
    // from module import name
    const moduleNode = node.childForFieldName("module_name");
    if (moduleNode) {
      source = getNodeText(moduleNode, sourceCode);
    }

    for (const child of node.children) {
      if (child.type === "dotted_name" || child.type === "identifier") {
        imports.push(getNodeText(child, sourceCode));
      }
    }
  }

  return {
    uuid: crypto.randomUUID(),
    source,
    imports,
    isDefault: false,
    line: location.startLine,
  };
}

/**
 * Extract function from Go node
 */
function extractGoFunction(node: Parser.SyntaxNode, sourceCode: string): ExtractedFunction | null {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return null;

  const name = getNodeText(nameNode, sourceCode);
  const location = getNodeLocation(node);

  // Extract parameters
  const params: string[] = [];
  const paramsNode = node.childForFieldName("parameters");
  if (paramsNode) {
    for (const param of paramsNode.children) {
      if (param.type === "parameter_declaration") {
        const nameNode = param.childForFieldName("name");
        if (nameNode) {
          params.push(getNodeText(nameNode, sourceCode));
        }
      }
    }
  }

  // Extract return type
  const resultNode = node.childForFieldName("result");
  const returnType = resultNode ? getNodeText(resultNode, sourceCode) : undefined;

  return {
    uuid: crypto.randomUUID(),
    name,
    params,
    returnType,
    startLine: location.startLine,
    endLine: location.endLine,
    startColumn: location.startColumn,
    endColumn: location.endColumn,
    isAsync: false, // Go doesn't have async
    isExport: name[0] === name[0]?.toUpperCase(), // Go exports by capitalization
  };
}

/**
 * Extract type (struct/interface) from Go node
 */
function extractGoType(node: Parser.SyntaxNode, sourceCode: string): ExtractedClass | null {
  const specNode = node.children.find((child) => child.type === "type_spec");
  if (!specNode) return null;

  const nameNode = specNode.childForFieldName("name");
  if (!nameNode) return null;

  const name = getNodeText(nameNode, sourceCode);
  const location = getNodeLocation(node);

  return {
    uuid: crypto.randomUUID(),
    name,
    methods: [],
    properties: [],
    startLine: location.startLine,
    endLine: location.endLine,
    startColumn: location.startColumn,
    endColumn: location.endColumn,
    isExport: name[0] === name[0]?.toUpperCase(),
  };
}

/**
 * Extract import from Go node
 */
function extractGoImport(node: Parser.SyntaxNode, sourceCode: string): ExtractedImport | null {
  const location = getNodeLocation(node);
  const imports: string[] = [];

  // Go imports can be single or grouped
  for (const child of node.children) {
    if (child.type === "import_spec") {
      const pathNode = child.childForFieldName("path");
      if (pathNode) {
        const source = getNodeText(pathNode, sourceCode).replace(/"/g, "");
        imports.push(source);
      }
    }
  }

  return {
    uuid: crypto.randomUUID(),
    source: imports[0] || "",
    imports,
    isDefault: false,
    line: location.startLine,
  };
}

/**
 * Main extraction function - detects language and extracts entities
 */
export function extractEntities(
  tree: Parser.Tree,
  sourceCode: string,
  language: string
): CodeEntities {
  switch (language) {
    case "typescript":
    case "tsx":
    case "javascript":
    case "jsx":
      return extractTypeScriptEntities(tree, sourceCode);
    case "python":
      return extractPythonEntities(tree, sourceCode);
    case "go":
      return extractGoEntities(tree, sourceCode);
    default:
      return { functions: [], classes: [], imports: [] };
  }
}
