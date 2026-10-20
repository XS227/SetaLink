import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';

const mockGetChannel = jest.fn();
const mockWatched = jest.fn();
jest.mock('../services/liveTvService', () => ({
  getChannel: (...args: any[]) => mockGetChannel(...args), reportChannel: jest.fn(),
  addAccountFavorite: jest.fn(), removeAccountFavorite: jest.fn(),
}));
jest.mock('react-native-video', () => {
  const React = require('react');
  return { __esModule: true, default: React.forwardRef((props: any, ref: any) => React.createElement('Video', { ...props, ref })) };
});
jest.mock('react-native-orientation-locker', () => ({ lockToLandscape: jest.fn(), lockToPortrait: jest.fn() }));
jest.mock('react-native-keep-awake', () => ({ activate: jest.fn(), deactivate: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../i18n', () => ({ useT: () => ({ t: (key: string) => key, isRTL: false }) }));
jest.mock('../stores/authStore', () => ({ useAuthStore: () => '' }));
jest.mock('../stores/toastStore', () => ({ useToastStore: () => jest.fn() }));
jest.mock('../stores/liveTvLocalStore', () => ({ useLiveTvLocalStore: () => ({ isFavorite: () => false, toggleFavorite: jest.fn(), recordWatched: mockWatched }) }));
jest.mock('../services/ssoService', () => ({ getSsoToken: jest.fn() }));
jest.mock('../services/analytics', () => ({ trackEvent: jest.fn() }));

import { LiveTvPlayerScreen } from '../screens/LiveTvPlayerScreen';

const channel = (id: string) => ({ id, name: id, stream_url: `https://example.com/${id}.m3u8` });
const deferred = () => {
  let resolve!: (value: any) => void;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

describe('Live TV playback recovery', () => {
  let tree: renderer.ReactTestRenderer;
  const press = async (text: string) => {
    const button = tree.root.findAllByType(TouchableOpacity).reverse().find((n) =>
      n.findAllByType(Text).some((t) => t.props.children === text));
    expect(button).toBeDefined();
    await act(async () => { button!.props.onPress(); });
  };
  beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); });
  afterEach(() => { act(() => tree?.unmount()); jest.useRealTimers(); });
  const mount = async () => {
    await act(async () => { tree = renderer.create(<LiveTvPlayerScreen channelId="a" channelIds={['a', 'b']} onBack={jest.fn()} />); });
  };

  it('gives the stream a full loading window after a slow channel lookup', async () => {
    const pending = deferred();
    mockGetChannel.mockReturnValueOnce(pending.promise);
    await mount();
    await act(async () => { jest.advanceTimersByTime(9500); pending.resolve(channel('a')); });
    await act(async () => { jest.advanceTimersByTime(20_000); });
    expect(tree.root.findAllByType('Video' as any)).toHaveLength(1);
    await act(async () => { jest.advanceTimersByTime(10_001); });
    expect(tree.root.findAllByType('Video' as any)).toHaveLength(0);
  });

  it('remounts the native stream on retry and ignores callbacks from the failed attempt', async () => {
    mockGetChannel.mockResolvedValue(channel('a'));
    await mount();
    const oldVideo = tree.root.findByType('Video' as any).props;
    await act(async () => { oldVideo.onError({ error: { errorCode: '22002' } }); });
    await press('livetv.retry');
    expect(mockGetChannel).toHaveBeenCalledTimes(2);
    expect(tree.root.findAllByType('Video' as any)).toHaveLength(1);
    await act(async () => { oldVideo.onError({ error: { errorCode: '24003' } }); });
    expect(tree.root.findAllByType('Video' as any)).toHaveLength(1);
  });

  it('does not let a late channel response replace the channel selected next', async () => {
    const pending = deferred();
    mockGetChannel.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(channel('b'));
    await mount();
    await press('⏭');
    expect(tree.root.findByType('Video' as any).props.source.uri).toContain('/b.m3u8');
    await act(async () => { pending.resolve(channel('a')); });
    expect(tree.root.findByType('Video' as any).props.source.uri).toContain('/b.m3u8');
  });
});
