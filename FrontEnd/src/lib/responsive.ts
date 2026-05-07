import { useEffect, useState } from 'react';
import { Dimensions, Platform, ScaledSize } from 'react-native';

const DESKTOP_BREAKPOINT = 900;

export function useDesktopLayout(): boolean {
  const [desktop, setDesktop] = useState<boolean>(() => {
    if (Platform.OS !== 'web') return false;
    return Dimensions.get('window').width >= DESKTOP_BREAKPOINT;
  });

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onChange = ({ window }: { window: ScaledSize }) => {
      setDesktop(window.width >= DESKTOP_BREAKPOINT);
    };
    const sub = Dimensions.addEventListener('change', onChange);
    return () => sub.remove();
  }, []);

  return desktop;
}
