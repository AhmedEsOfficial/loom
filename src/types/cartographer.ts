import type { MapNodeId } from "./common.js";
import type { SymbolDetail } from "./substrate.js";

export type MapLevel = "file" | "module" | "package" | "repo";

export interface MapNode {
  id: MapNodeId;
  repoId: string;
  path: string;
  level: MapLevel;
  parentId: MapNodeId | null;
  summary: string;
  publicApi: string[];
  complexityScore: number; // 0.0 - 1.0
  exemplarCallers: string[];
  language: string;
  loc: number;
  gitSha: string;
  updatedAt: number;
}

export type MapNodeInsert = Omit<MapNode, "id" | "updatedAt">;

export interface CodebaseMap {
  repoId: string;
  rootNodeId: MapNodeId;
  gitSha: string;
  nodeCount: number;
  languages: Record<string, number>;
}

export interface ParsedFile {
  filePath: string;
  language: string;
  symbols: ParsedSymbol[];
  imports: string[];
  exports: string[];
  loc: number;
  complexityScore: number;
}

export interface ParsedSymbol {
  name: string;
  kind: SymbolDetail["kind"];
  startLine: number;
  endLine: number;
  signature: string;
  docstring?: string;
  children?: ParsedSymbol[];
}

export interface CartographerEvents {
  onFileIndexed?: (filePath: string, symbolCount: number) => void;
  onNodeSummarized?: (nodeId: MapNodeId) => void;
  onMapComplete?: (map: CodebaseMap) => void;
  onError?: (error: Error, filePath?: string) => void;
}

export interface Cartographer {
  /** Build a complete codebase map for a repository */
  buildMap(repoPath: string, events?: CartographerEvents): Promise<CodebaseMap>;

  /** Incrementally update the map for changed files */
  refreshMap(repoPath: string, changedFiles: string[]): Promise<void>;

  /** Query the map at a given node, with optional depth for children */
  queryMap(nodeId: MapNodeId, depth?: number): Promise<MapNode[]>;

  /** Zoom to a specific path at a given resolution level */
  zoomTo(path: string, level?: MapLevel): Promise<MapNode | null>;

  /** Find symbols by name across the codebase */
  findSymbol(name: string): Promise<SymbolDetail[]>;

  /** Start file watching for incremental updates */
  startWatching(repoPath: string): void;

  /** Stop file watching */
  stopWatching(): void;
}
