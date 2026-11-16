/** The local date and time of `at`, each part zero-padded: the clock as the person who runs the command reads it (a cloud container's is usually UTC). */
export function localParts(at: Date): Readonly<{ year: string; month: string; day: string; hour: string; minute: string }> {
  const two = (n: number) => String(n).padStart(2, "0");
  return { year: String(at.getFullYear()), month: two(at.getMonth() + 1), day: two(at.getDate()), hour: two(at.getHours()), minute: two(at.getMinutes()) };
}
