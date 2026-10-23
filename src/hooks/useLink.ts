import {useEffect, useSyncExternalStore} from 'react';
import {Link, linkStore} from '../services/api';

// The TV's paired-phone link (null until a phone has paired). Loaded from
// storage once per app run.
export function useLink(): Link | null {
  useEffect(() => {
    linkStore.load();
  }, []);
  return useSyncExternalStore(linkStore.subscribe, linkStore.get);
}
