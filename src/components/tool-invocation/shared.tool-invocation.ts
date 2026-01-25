export const sanitizeCssVariableName = (label: string) => {
  // Guard against undefined/null/empty values
  if (!label || typeof label !== "string") {
    return "unknown";
  }
  return label
    .replaceAll(" ", "")
    .toLowerCase()
    .replace(/[^a-z0-9\-_]/g, "_");
};
