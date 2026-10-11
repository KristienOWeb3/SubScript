/** Shared browser/server validation; contains no credential hashing or secrets. */
export function validTransactionPin(value: unknown): value is string {
    return typeof value === "string" && /^\d{6}$/.test(value) && !/^(\d)\1{5}$/.test(value)
        && !"012345678901234".includes(value) && !"987654321098765".includes(value);
}
