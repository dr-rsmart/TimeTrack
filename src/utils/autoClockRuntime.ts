/** Select exactly one automatic clocking implementation at runtime. */
export type AutoClockRuntime = 'disabled' | 'web' | 'native';

export function getAutoClockRuntime(
  enabled: boolean,
  nativeShellPresent: boolean,
): AutoClockRuntime {
  if (!enabled) return 'disabled';
  return nativeShellPresent ? 'native' : 'web';
}
