import type { PizzaCatalog } from '../domain/pizza'

/** Small catalog shared by the pizza builder UI tests. */
export const pizzaCatalogFixture: PizzaCatalog = {
  sizes: [
    { code: 'chica', name: 'Chica', allowedPortions: [1, 2], sortOrder: 1 },
    { code: 'grande', name: 'Grande', allowedPortions: [1, 2, 3, 4], sortOrder: 2 },
  ],
  styles: [
    { id: 'varas', name: 'Estilo Varas', description: 'Pepperoni y queso', kind: 'special', includedIngredients: 0, sortOrder: 1 },
    { id: 'custom', name: 'Arma tu combinación', description: '', kind: 'custom', includedIngredients: 2, sortOrder: 2 },
  ],
  ingredients: [
    { id: 'pep', name: 'Pepperoni', sortOrder: 1 },
    { id: 'jal', name: 'Jalapeños', sortOrder: 2 },
    { id: 'pina', name: 'Piña', sortOrder: 3 },
  ],
}
