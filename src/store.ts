import {createWasmDuckDbConnector} from '@sqlrooms/duckdb';
import {
  createRoomShellSlice,
  createRoomStore,
  LayoutTypes,
  RoomShellSliceState,
} from '@sqlrooms/room-shell';
import {createMosaicSlice} from '@sqlrooms/mosaic';
import type {MosaicSliceState} from './mosaicTypes';
import {DatabaseIcon} from 'lucide-react';
import {MainView} from './components/MainView';
import {DataPanel} from './components/DataPanel';

// 只保留最基礎的狀態
export type RoomState = RoomShellSliceState & MosaicSliceState;

export const {roomStore, useRoomStore} = createRoomStore<RoomState>(
  (set, get, store) => ({
    ...createRoomShellSlice({
      connector: createWasmDuckDbConnector(), // 淨空設定
      config: {
        layout: {
          type: LayoutTypes.enum.mosaic,
          nodes: 'main', 
        },
        dataSources: [], // 🚨 絕對為空
      },
      room: {
        panels: {
          main: {
            title: 'Main view',
            icon: () => null,
            component: MainView,
            placement: 'main',
          },
          data: {
            title: 'Data',
            icon: DatabaseIcon,
            component: DataPanel,
            placement: 'sidebar',
          },
        },
      },
    })(set, get, store),
    // Mosaic 共用上面這一個 DuckDB-WASM 連線（不另開）；圖表用的是 vg.* 與全域 coordinator
    ...createMosaicSlice()(set, get, store),
  }),
);