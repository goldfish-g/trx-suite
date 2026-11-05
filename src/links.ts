// Addresses this deployment can point players to, set when it is built.

/**
 * The TRX Level Converter, which turns custom levels made for the original
 * games or older engines into packages TRX plays (trx-update-tool). Set
 * VITE_LEVEL_CONVERTER_URL to link to it.
 */
export const LEVEL_CONVERTER_URL: string | null = import.meta.env.VITE_LEVEL_CONVERTER_URL || null;
