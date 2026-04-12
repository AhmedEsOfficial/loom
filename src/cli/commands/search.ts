import { LoomKernel } from "../../kernel.js";
import { loadConfig } from "../config.js";

export async function searchCommand(query: string): Promise<void> {
  const config = await loadConfig();
  const kernel = new LoomKernel(config);

  try {
    console.log(`Searching for: "${query}"\n`);

    // FTS search over episodes
    const ftsResults = await kernel.substrate.search(query, { limit: 10 });

    if (ftsResults.length > 0) {
      console.log(`Episodes (${ftsResults.length} results):`);
      for (const result of ftsResults) {
        const preview = result.content.length > 120
          ? result.content.slice(0, 120) + "..."
          : result.content;
        console.log(`  [${result.rank.toFixed(2)}] ${result.id}`);
        console.log(`    ${preview}`);
        if (result.toolName) {
          console.log(`    Tool: ${result.toolName}`);
        }
      }
    } else {
      console.log("No episode matches found.");
    }

    // Symbol search
    const symbols = await kernel.cartographer.findSymbol(query);
    if (symbols.length > 0) {
      console.log(`\nSymbols (${symbols.length} results):`);
      for (const sym of symbols) {
        console.log(`  ${sym.kind} ${sym.name} at ${sym.filePath}:${sym.startLine}-${sym.endLine}`);
        console.log(`    ${sym.signature}`);
      }
    }

    // Skill search
    const skills = await kernel.substrate.skillLookup(query);
    if (skills.length > 0) {
      console.log(`\nSkills (${skills.length} results):`);
      for (const skill of skills) {
        console.log(`  ${skill.name}: ${skill.description}`);
      }
    }
  } finally {
    kernel.shutdown();
  }
}
