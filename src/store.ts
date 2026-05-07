import {createWasmDuckDbConnector} from '@sqlrooms/duckdb';
import {
  createRoomShellSlice,
  createRoomStore,
  LayoutTypes,
  RoomShellSliceState,
} from '@sqlrooms/room-shell';
import {MainView} from './components/MainView';

// 只保留最基礎的狀態
export type RoomState = RoomShellSliceState;

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
        },
      },
    })(set, get, store),
  }),
);