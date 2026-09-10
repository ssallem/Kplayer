export function mediaStem(name) {
  return name
    .normalize("NFC")
    .replace(/\.[^.]+$/, "")
    .replace(/ · TV$/, "")
    .trim()
    .toLocaleLowerCase("ko");
}
export function matchingSubtitle(item, items) {
  if (!item) return null;
  return (
    items
      .filter(
        (s) =>
          s.kind === "subtitle" && mediaStem(s.name) === mediaStem(item.name),
      )
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null
  );
}
