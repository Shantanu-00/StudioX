import {useCallback} from 'react';
import {useToastKepler} from '@amazon-devices/react-native-kepler';
import {CDN, FEATURES} from '../config';

export type Confirm = (title: string, description: string) => void;

// Icon for the system toast: the phone app's icon on the same CDN.
// Unverified until the phone app is deployed there.
const TOAST_ICON = `${CDN}/link/icons/icon-192.png`;

// The Vega system toast, when the manifest grants
// com.amazon.notification.privilege.post (FEATURES.systemToast). Otherwise
// null, and callers show their own in-app confirmation. The flag is a build
// constant, so the hook order never changes between renders.
export const useSystemToast: () => Confirm | null = FEATURES.systemToast
  ? () => {
      const {show} = useToastKepler();
      return useCallback<Confirm>(
        (title, description) => show({title, description, iconUri: TOAST_ICON}),
        [show],
      );
    }
  : () => null;
