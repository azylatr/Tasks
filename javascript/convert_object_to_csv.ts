/**
 * @param data - JSON object to convert
 * @returns A CSV-formatted string or null
 * @description Recursively converts a JSON object to a single-line, comma-separated string
 * It handles nested objects and joins key-value pairs with a space
 *
 *
 * @example
 * // For [{ name: 'aiyaas', age: 2 }]
 * // Output: "0, name, aiyaas age, 2"
 *
 * @example
 * // For { person: { name: 'aiyaas' }, status: 'online' }
 * // Output: "person, name, aiyaas status, online"
 */
function formatToCsv(data: object): string | null {
  // Convert some 'JSON' to 'CSV' type
  if (typeof data === 'object' && data !== null) {
    return Object.entries(data)
      .map(([key, value]) => {
        return typeof value === 'object' && value !== null
          ? `${key}, ${formatToCsv(value)}`
          : `${key}, ${value}`;
      })
      .join(' '); // Add (\n) if you want to change the line
  }

  return null;
};
