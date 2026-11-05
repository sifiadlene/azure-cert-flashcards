const filenamePattern = /^(?<slug>[a-z0-9]+)_flashcards(?:_(?<count>\d+))?_(?<date>\d{4}-\d{2}-\d{2})\.csv$/i

export function toDisplayCode(slug) {
  const match = slug.match(/^([a-z]+)(\d+)$/i)
  return match ? `${match[1].toUpperCase()}-${match[2]}` : slug.toUpperCase()
}

function pickPreferredFile(currentFile, nextFile) {
  if (!currentFile) return nextFile
  if (nextFile.date > currentFile.date) return nextFile
  if (nextFile.date < currentFile.date) return currentFile
  if (nextFile.count > currentFile.count) return nextFile
  if (nextFile.count < currentFile.count) return currentFile
  return nextFile.filename > currentFile.filename ? nextFile : currentFile
}

export function selectLatestDecks(filenames) {
  const latestDecks = new Map()
  for (const filename of filenames) {
    const match = filename.match(filenamePattern)
    if (!match?.groups) continue

    const candidate = {
      filename,
      slug: match.groups.slug.toLowerCase(),
      count: Number(match.groups.count ?? '0'),
      date: match.groups.date,
    }
    latestDecks.set(candidate.slug, pickPreferredFile(latestDecks.get(candidate.slug), candidate))
  }
  return [...latestDecks.values()].sort((left, right) => left.slug.localeCompare(right.slug))
}
