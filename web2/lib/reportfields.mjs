// Extracts stage-relevant facts from a report's `## Machine Summary` yaml block.
// Minimal, defensive line parsing — the block is advisory (untrusted content is
// rendered as text, never executed).
export function parseMachineSummaryFields(md) {
  const fields = { final_decision: "", hard_stops: [], soft_gaps: [], top_reasons: [] };
  const marker = "## Machine Summary";
  const start = md.indexOf(marker);
  if (start === -1) return fields;
  let section = md.slice(start);
  const fence = section.indexOf("```");
  if (fence === -1) return fields;
  section = section.slice(fence + 3);
  const endFence = section.indexOf("```");
  const yaml = (endFence === -1 ? section : section.slice(0, endFence)).replace(/^yaml\n/, "");

  let currentList = null;
  for (const line of yaml.split(/\r?\n/)) {
    const listMatch = /^\s{2,6}-\s*"?(.*?)"?\s*$/.exec(line);
    const keyMatch = /^([a-z_]+):\s*(.*)$/.exec(line.trim());
    if (keyMatch) {
      const key = keyMatch[1];
      const value = keyMatch[2].trim().replace(/^"|"$/g, "");
      if (value && key === "final_decision") {
        fields[key] = value;
        currentList = null;
      } else if (key === "final_decision") {
        // bare key with inline quote artifacts stripped to empty
        fields[key] = value;
      } else if (["hard_stops", "soft_gaps", "top_reasons"].includes(key)) {
        currentList = key;
      }
    } else if (currentList && listMatch && listMatch[1].trim()) {
      fields[currentList].push(listMatch[1].trim().replace(/^"|"$/g, ""));
    }
  }
  return fields;
}

// Header facts (Score/Legitimacy/Archetype) parse in lib/reports.mjs.
export function extractImplementerFields(md) {
  return parseMachineSummaryFields(md);
}
