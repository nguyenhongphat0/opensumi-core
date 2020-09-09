import { Disposable } from '@ali/ide-core-browser';
import { BreakpointWidgetInputFocus } from '@ali/ide-debug/lib/browser';
import { createBrowserInjector } from '@ali/ide-dev-tool/src/injector-helper';
import { DebugBreakpointWidget } from '@ali/ide-debug/lib/browser/editor';
import { DebugEditor } from '@ali/ide-debug';

describe('Debug Breakpoint Widget', () => {
  const mockInjector = createBrowserInjector([]);
  let debugBreakpointWidget: DebugBreakpointWidget;

  const mockDebugEditor = {
    onDidLayoutChange: jest.fn(() => Disposable.create(() => {})),
    getLayoutInfo: jest.fn(() => ({width: 100, height: 100})),
    changeViewZones: jest.fn(() => Disposable.create(() => {})),
  };

  beforeAll(() => {
    mockInjector.overrideProviders({
      token: DebugEditor,
      useValue: mockDebugEditor,
    });
    mockInjector.overrideProviders({
      token: BreakpointWidgetInputFocus,
      useValue: {},
    });
    debugBreakpointWidget = mockInjector.get(DebugBreakpointWidget);
  });

  it('should have enough API', () => {
    expect(debugBreakpointWidget.position).toBeUndefined();
    expect(debugBreakpointWidget.values).toBeUndefined();
    expect(typeof debugBreakpointWidget.show).toBe('function');
    expect(typeof debugBreakpointWidget.hide).toBe('function');
  });

  it('show method should be work', () => {
    const position = {lineNumber: 1, column: 2} as monaco.Position;
    debugBreakpointWidget.show(position);
    expect(mockDebugEditor.onDidLayoutChange).toBeCalledTimes(1);
    expect(mockDebugEditor.getLayoutInfo).toBeCalledTimes(1);
    expect(mockDebugEditor.changeViewZones).toBeCalledTimes(1);

    expect(debugBreakpointWidget.position).toBe(position);
  });

  it('hide method should be work', (done) => {
    debugBreakpointWidget.hide();
    done();
  });
});