import { Injectable, Autowired, INJECTOR_TOKEN, Injector } from '@ali/common-di';
import { toDisposable, Event, CommandService, positionToRange, URI } from '@ali/ide-core-common';
import { IDocPersistentCacheProvider } from '@ali/ide-editor';
import { EditorDocumentModel } from '@ali/ide-editor/src/browser/doc-model/main';
import { EmptyDocCacheImpl, IEditorDocumentModelService } from '@ali/ide-editor/src/browser';
import { createMockedMonaco } from '@ali/ide-monaco/lib/__mocks__/monaco';
import { EditorCollectionService } from '@ali/ide-editor';

import { createBrowserInjector } from '../../../../../tools/dev-tool/src/injector-helper';
import { MockInjector } from '../../../../../tools/dev-tool/src/mock-injector';

import { MockSCMProvider } from '../../scm-test-util';

import { DirtyDiffModel } from '../../../src/browser/dirty-diff/dirty-diff-model';
import { DirtyDiffWidget } from '../../../src/browser/dirty-diff/dirty-diff-widget';
import { SCMService, ISCMRepository } from '../../../src';

@Injectable()
class MockEditorDocumentModelService {
  @Autowired(INJECTOR_TOKEN)
  private readonly injector: Injector;

  async createModelReference(uri: URI) {
    const instance = this.injector.get(EditorDocumentModel, [
      uri,
      'test-content',
    ]);

    return { instance };
  }
}

const mockedMonaco = createMockedMonaco();
(global as any).monaco = mockedMonaco;

jest.useFakeTimers();

// mock ThrottledDelayer to take it easy in unit test
jest.mock('@ali/ide-core-common/src/async', () => ({
  ...jest.requireActual('@ali/ide-core-common/src/async'),
  ThrottledDelayer: class {
    constructor() {}
    trigger(promiseFactory: () => Promise<any>) {
      return promiseFactory();
    }
    cancel() {}
  },
}));

describe('scm/src/browser/dirty-diff/dirty-diff-model.ts', () => {
  describe('test for DirtyDiffDecorator', () => {
    let injector: MockInjector;
    let fileTextModel: monaco.editor.ITextModel;
    let gitTextModel: monaco.editor.ITextModel;
    let scmService: SCMService;
    let repo: ISCMRepository;
    let commandService: CommandService;
    let provider: MockSCMProvider;
    let codeEditor: monaco.editor.ICodeEditor;

    let computeDiffRet: monaco.commons.IDiffComputationResult | null = null;
    const mockComputeDiff = jest.fn();

    beforeEach(() => {
      mockedMonaco.services!.StaticServices.editorWorkerService.get = (() => {
        return {
          canComputeDiff: (): boolean => true,
          computeDiff: async () => computeDiffRet,
        };
      }) as any;

      injector = createBrowserInjector([], new MockInjector([
        {
          token: IDocPersistentCacheProvider,
          useClass: EmptyDocCacheImpl,
        },
        {
          token: IEditorDocumentModelService,
          useClass: MockEditorDocumentModelService,
        },
        {
          token: CommandService,
          useValue: {
            executeCommand: jest.fn(),
          },
        },
        {
          token: EditorCollectionService,
          useValue: {},
        },
        SCMService,
      ]));

      fileTextModel = injector.get(EditorDocumentModel, [
        URI.file('/test/workspace/abc.ts'),
        'test',
      ]).getMonacoModel();

      gitTextModel = injector.get(EditorDocumentModel, [
        URI.from({
          scheme: 'git',
          path: 'test/workspace/abc.ts',
          query: 'ref=""',
        }),
        'test',
      ]).getMonacoModel();

      scmService = injector.get(SCMService);
      provider = new MockSCMProvider(1);
      repo = scmService.registerSCMProvider(provider);
      commandService = injector.get(CommandService);

      codeEditor = mockedMonaco.editor!.create(document.createElement('div'));
      codeEditor.setModel(fileTextModel);
    });

    afterEach(() => {
      codeEditor.setModel(null);
      codeEditor.dispose();
      fileTextModel.dispose();
      mockComputeDiff.mockRestore();
    });

    it('ok: check basic property', () => {
      const dirtyDiffModel = injector.get(DirtyDiffModel, [fileTextModel]);
      expect(dirtyDiffModel.modified).toEqual(fileTextModel);
      expect(dirtyDiffModel.original).toBeUndefined();
      expect(dirtyDiffModel.changes).toEqual([]);

      // private property
      const editorWorkerServiceMethods = Object.keys(dirtyDiffModel['editorWorkerService']);
      expect(editorWorkerServiceMethods).toContain('canComputeDiff');
      expect(editorWorkerServiceMethods).toContain('computeDiff');
    });

    it('ok for one repo', () => {
      const dirtyDiffModel = injector.get(DirtyDiffModel, [fileTextModel]);
      expect(dirtyDiffModel.modified).toEqual(fileTextModel);

      dirtyDiffModel['_originalModel'] = gitTextModel;
      expect(dirtyDiffModel.original).toEqual(gitTextModel);

      // mock computeDiff compute a diff changes
      const change0 = {
        originalStartLineNumber: 2,
        originalEndLineNumber: 5,
        modifiedStartLineNumber: 6,
        modifiedEndLineNumber: 8,
        charChanges: [],
      };
      computeDiffRet = {
        identical: false,
        changes: [change0],
      };
      fileTextModel.setValue('insert some content for testing');

      return Event.toPromise(dirtyDiffModel.onDidChange).then((changes) => {
        expect(changes).toEqual([{
          start: 0,
          deleteCount: 0,
          toInsert: [change0],
        }]);
        expect(dirtyDiffModel.original?.uri.scheme).toBe('git');
      });
    });

    it('ok when repo#onDidChange', () => {
      const dirtyDiffModel = injector.get(DirtyDiffModel, [fileTextModel]);
      dirtyDiffModel['_originalModel'] = gitTextModel;

      // mock computeDiff compute a diff changes
      const change0 = {
        originalStartLineNumber: 2,
        originalEndLineNumber: 5,
        modifiedStartLineNumber: 6,
        modifiedEndLineNumber: 8,
        charChanges: [],
      };

      computeDiffRet = {
        identical: false,
        changes: [change0],
      };
      provider.onDidChangeEmitter.fire();

      return Event.toPromise(dirtyDiffModel.onDidChange).then((changes) => {
        expect(changes).toEqual([{
          start: 0,
          deleteCount: 0,
          toInsert: [change0],
        }]);
        expect(dirtyDiffModel.original?.uri.scheme).toBe('git');
      });
    });

    it('ok when repo#onDidChangeResources', () => {
      const dirtyDiffModel = injector.get(DirtyDiffModel, [fileTextModel]);
      dirtyDiffModel['_originalModel'] = gitTextModel;

      // mock computeDiff compute a diff changes
      const change0 = {
        originalStartLineNumber: 2,
        originalEndLineNumber: 5,
        modifiedStartLineNumber: 6,
        modifiedEndLineNumber: 8,
        charChanges: [],
      };

      computeDiffRet = {
        identical: false,
        changes: [change0],
      };
      provider.onDidChangeResourcesEmitter.fire();

      return Event.toPromise(dirtyDiffModel.onDidChange).then((changes) => {
        expect(changes).toEqual([{
          start: 0,
          deleteCount: 0,
          toInsert: [change0],
        }]);
        expect(dirtyDiffModel.original?.uri.scheme).toBe('git');
      });
    });

    it('ok for no repo', () => {
      repo.dispose();
      const dirtyDiffModel = injector.get(DirtyDiffModel, [fileTextModel]);
      dirtyDiffModel['_originalModel'] = gitTextModel;

      // no repo matched so won't trigger any onDidChange event
      const eventSpy = jest.spyOn(dirtyDiffModel['_onDidChange'], 'fire');
      const triggerDiffSpy = jest.spyOn<DirtyDiffModel, any>(dirtyDiffModel, 'triggerDiff');

      expect(dirtyDiffModel.modified).toEqual(fileTextModel);
      fileTextModel.setValue('insert some content for testing');
      jest.runAllTimers();

      expect(eventSpy).toHaveBeenCalledTimes(0);
      // editor content changed trigger a `triggerDiff`
      expect(triggerDiffSpy).toHaveBeenCalledTimes(1);
      eventSpy.mockReset();
      triggerDiffSpy.mockReset();
    });

    it('find changes', () => {
      const dirtyDiffModel = injector.get(DirtyDiffModel, [fileTextModel]);
      dirtyDiffModel['_originalModel'] = gitTextModel;
      const change0 = {
        originalStartLineNumber: 11,
        originalEndLineNumber: 11,
        modifiedStartLineNumber: 11,
        modifiedEndLineNumber: 11,
      };
      const change1 = {
        originalStartLineNumber: 12,
        originalEndLineNumber: 12,
        modifiedStartLineNumber: 12,
        modifiedEndLineNumber: 12,
      };
      const change2 = {
        originalStartLineNumber: 14,
        originalEndLineNumber: 14,
        modifiedStartLineNumber: 14,
        modifiedEndLineNumber: 14,
      };
      const change3 = {
        originalStartLineNumber: 15,
        originalEndLineNumber: 15,
        modifiedStartLineNumber: 15,
        modifiedEndLineNumber: 15,
      };

      dirtyDiffModel['_changes'] = [change0, change1, change2, change3];

      // findNextClosestChangeLineNumber\findPreviousClosestChangeLineNumber
      expect(dirtyDiffModel.findNextClosestChangeLineNumber(11)).toBe(11);
      expect(dirtyDiffModel.findNextClosestChangeLineNumber(11, false)).toBe(12);
      expect(dirtyDiffModel.findNextClosestChangeLineNumber(12, false)).toBe(14);

      expect(dirtyDiffModel.findNextClosestChangeLineNumber(10, false)).toBe(11);
      expect(dirtyDiffModel.findNextClosestChangeLineNumber(16, false)).toBe(11);

      expect(dirtyDiffModel.findPreviousClosestChangeLineNumber(15)).toBe(15);
      expect(dirtyDiffModel.findPreviousClosestChangeLineNumber(15, false)).toBe(14);
      expect(dirtyDiffModel.findPreviousClosestChangeLineNumber(14, false)).toBe(12);

      expect(dirtyDiffModel.findPreviousClosestChangeLineNumber(10, false)).toBe(15);
      expect(dirtyDiffModel.findPreviousClosestChangeLineNumber(16, false)).toBe(15);

      // getChangeFromRange
      expect(dirtyDiffModel.getChangeFromRange(positionToRange(10))).toEqual({
        change: change0,
        count: 1,
      });
      expect(dirtyDiffModel.getChangeFromRange(positionToRange(11))).toEqual({
        change: change0,
        count: 1,
      });
      expect(dirtyDiffModel.getChangeFromRange(positionToRange(12))).toEqual({
        change: change1,
        count: 2,
      });
      expect(dirtyDiffModel.getChangeFromRange(positionToRange(15))).toEqual({
        change: change3,
        count: 4,
      });
      expect(dirtyDiffModel.getChangeFromRange(positionToRange(16))).toEqual({
        change: change0,
        count: 1,
      });
    });

    it('dispose', () => {
      const dirtyDiffModel = injector.get(DirtyDiffModel, [fileTextModel]);
      dirtyDiffModel['_originalModel'] = gitTextModel;

      dirtyDiffModel['_originalModel'] = injector.get(EditorDocumentModel, [
        URI.from({
          scheme: 'git',
          path: 'test/workspace/abc.ts',
          query: 'ref=""',
        }),
        'test',
      ]).getMonacoModel();
      const delayerSpy = jest.spyOn(dirtyDiffModel['diffDelayer']!, 'cancel');

      dirtyDiffModel['repositoryDisposables'].add(toDisposable(jest.fn()));
      dirtyDiffModel['repositoryDisposables'].add(toDisposable(jest.fn()));
      expect(dirtyDiffModel['repositoryDisposables'].size).toBeGreaterThan(0);

      dirtyDiffModel.dispose();

      expect(dirtyDiffModel.original).toBeNull();
      expect(dirtyDiffModel.modified).toBeNull();
      expect(delayerSpy).toBeCalledTimes(1);
      expect(dirtyDiffModel['diffDelayer']).toBeNull();
      expect(dirtyDiffModel['repositoryDisposables'].size).toBe(0);

      delayerSpy.mockReset();
    });

    describe('onClickDecoration', () => {
      let mockCompare: jest.Mock;
      let originalMonacoEditor: monaco.editor.ICodeEditor;
      let modifiedMonacoEditor: monaco.editor.ICodeEditor;

      let dirtyDiffModel: DirtyDiffModel;
      let dirtyDiffWidget: DirtyDiffWidget;

      beforeEach(() => {
        const diffEditor = mockedMonaco.editor!.createDiffEditor(document.createElement('div'));
        originalMonacoEditor = diffEditor.getOriginalEditor();
        modifiedMonacoEditor = diffEditor.getModifiedEditor();

        mockCompare = jest.fn();
        injector.overrideProviders({
          token: EditorCollectionService,
          useValue: {
            createDiffEditor: async () => {
              return {
                compare: mockCompare,
                originalEditor: { monacoEditor: originalMonacoEditor },
                modifiedEditor: { monacoEditor: modifiedMonacoEditor },
              };
            },
          },
        });

        DirtyDiffModel.prototype['triggerDiff'] = jest.fn(); // avoid `changes` changed
        dirtyDiffModel = injector.get(DirtyDiffModel, [fileTextModel]);
        dirtyDiffModel['_originalModel'] = gitTextModel;
        // dirtyDiffModel['triggerDiff'] = jest.fn(); // avoid `changes` changed
        dirtyDiffWidget = injector.get(DirtyDiffWidget, [codeEditor, dirtyDiffModel, commandService]);
      });

      it('basic check', () => {
        const range = positionToRange(10);
        const spy = jest.spyOn(dirtyDiffWidget, 'dispose');
        dirtyDiffModel['_widget'] = null;
        expect(spy).toBeCalledTimes(0);

        dirtyDiffModel.onClickDecoration(dirtyDiffWidget, range);
        expect(dirtyDiffModel['_widget']).toEqual(dirtyDiffWidget);
        expect(spy).toBeCalledTimes(0);

        const newDirtyDiffWidget = injector.get(DirtyDiffWidget, [codeEditor, dirtyDiffModel, commandService]);

        dirtyDiffModel.onClickDecoration(newDirtyDiffWidget, range);
        expect(spy).toBeCalledTimes(1);
        expect(dirtyDiffModel['_widget']).toEqual(newDirtyDiffWidget);

        spy.mockReset();
      });

      it('dirty editor in zone widget', async () => {
        const change0 = {
          originalStartLineNumber: 11,
          originalEndLineNumber: 11,
          modifiedStartLineNumber: 11,
          modifiedEndLineNumber: 11,
        };
        const change1 = {
          originalStartLineNumber: 12,
          originalEndLineNumber: 12,
          modifiedStartLineNumber: 12,
          modifiedEndLineNumber: 12,
        };
        const change2 = {
          originalStartLineNumber: 14,
          originalEndLineNumber: 14,
          modifiedStartLineNumber: 14,
          modifiedEndLineNumber: 14,
        };
        const change3 = {
          originalStartLineNumber: 15,
          originalEndLineNumber: 15,
          modifiedStartLineNumber: 15,
          modifiedEndLineNumber: 15,
        };

        dirtyDiffModel['_changes'].push(change1, change2, change3);

        const editorService = injector.get(EditorCollectionService);
        const spyList: jest.SpyInstance[] = [];
        const createDiffEditorSpy = jest.spyOn(editorService, 'createDiffEditor');
        const updateOptionsSpy1 = jest.spyOn(originalMonacoEditor, 'updateOptions');
        const updateOptionsSpy2 = jest.spyOn(modifiedMonacoEditor, 'updateOptions');
        const revealLineInCenterSpy = jest.spyOn(modifiedMonacoEditor, 'revealLineInCenter');
        const relayoutSpy = jest.spyOn(dirtyDiffWidget, 'relayout');
        spyList.push(
          createDiffEditorSpy,
          updateOptionsSpy1,
          updateOptionsSpy2,
          revealLineInCenterSpy,
          relayoutSpy,
        );

        const range = positionToRange(12);
        await dirtyDiffModel.onClickDecoration(dirtyDiffWidget, range);

        // createDiffEditor
        expect(createDiffEditorSpy).toBeCalledTimes(1);
        expect((createDiffEditorSpy.mock.calls[0][0] as HTMLDivElement).tagName).toBe('DIV');
        expect(createDiffEditorSpy.mock.calls[0][1]).toEqual({ automaticLayout: true, renderSideBySide: false });

        // editor.compare
        expect(mockCompare).toBeCalledTimes(1);
        expect(mockCompare.mock.calls[0][0].instance.uri.scheme).toBe('git');
        expect(mockCompare.mock.calls[0][1].instance.uri.scheme).toBe('file');

        // monacoEditor.updateOption
        expect(updateOptionsSpy1).toBeCalledTimes(1);
        expect(updateOptionsSpy2).toBeCalledTimes(1);
        expect(updateOptionsSpy1.mock.calls[0][0]).toEqual({ readOnly: true });
        expect(updateOptionsSpy2.mock.calls[0][0]).toEqual({ readOnly: true });

        // monacoEditor.revealLineInCenter
        expect(revealLineInCenterSpy).toBeCalledTimes(1);
        expect(revealLineInCenterSpy).toBeCalledWith(12 - 9);

        expect(dirtyDiffWidget.currentIndex).toBe(1);
        expect(dirtyDiffWidget.currentRange).toEqual(positionToRange(12));
        expect(dirtyDiffWidget.currentHeightInLines).toBe(18);

        // this.onDidChange
        dirtyDiffModel['_changes'].unshift(change0);
        dirtyDiffModel['_onDidChange'].fire([{
          start: 0,
          deleteCount: 0,
          toInsert: [change0],
        }]);

        expect(dirtyDiffWidget.currentIndex).toBe(2);
        expect(dirtyDiffWidget.currentRange).toEqual(positionToRange(12));
        expect(dirtyDiffWidget.currentHeightInLines).toBe(18);

        // originalEditor.monacoEditor.onDidChangeModelContent
        originalMonacoEditor['_onDidChangeModelContent'].fire();
        expect(relayoutSpy).toBeCalledTimes(1);
        expect(relayoutSpy).toBeCalledWith(18);

        // widget.onDispose
        dirtyDiffWidget.dispose();
        expect(dirtyDiffModel['_widget']).toBeNull();

        spyList.forEach((spy) => spy.mockReset());
      });
    });
  });
});