export function paginate(page: number, pageSize: number) {
  return { skip: (page - 1) * pageSize, limit: pageSize };
}
