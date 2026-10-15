import {api, db, fetch, EndpointError} from 'sdk';
import {createStorage} from './storage.js';
import {createService} from './service.js';
import {AppError} from './domain.js';
export const service=createService(createStorage(db),{api,fetcher:fetch});
export function publicError(error) {
  if(error instanceof AppError) return new EndpointError(error.message,{code:error.code});
  console.error('Voice Reader request failed');
  return new EndpointError('Не удалось выполнить запрос. Попробуйте позже.',{code:'INTERNAL'});
}
