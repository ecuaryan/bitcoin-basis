import { createContext, useContext } from 'react';

/** True while the Log sheet is saving a purchase or move straight from its form. */
export const SavingContext = createContext(false);
export const useSaving = (): boolean => useContext(SavingContext);
