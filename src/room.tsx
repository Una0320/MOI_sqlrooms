import {RoomShell} from '@sqlrooms/room-shell';
import {roomStore} from './store';

export const Room = () => {
  return (
    <RoomShell className="h-screen" roomStore={roomStore}>
      {/* tileClassName 蓋掉 @sqlrooms/layout 預設的 'p-2 bg-secondary/10'——
          那是留給多面板 dashboard 的分隔留白，我們只有全螢幕地圖這一個面板，
          留白 + light 主題的淡色背景疊在深色地圖外面看起來就是一圈白邊 */}
      <RoomShell.LayoutComposer tileClassName="p-0 bg-transparent" />
      <RoomShell.LoadingProgress />
      <RoomShell.CommandPalette />
    </RoomShell>
  );
};
