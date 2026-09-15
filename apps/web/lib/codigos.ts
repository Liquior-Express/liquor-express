// Los códigos de barras se comparan sin ceros a la izquierda: al guardar el Excel como número se
// pierden (080432402825 queda 80432402825) y hay lectores que agregan uno más al leer (EAN-13).
export const sinCeros = (c: string | null | undefined) => (c ?? '').trim().replace(/^0+/, '')
