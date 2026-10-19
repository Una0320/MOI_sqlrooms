import { useMemo } from 'react';
import { useShallow } from '@sqlrooms/room-shell';

import { resolveFiles, type FileSet } from '@/constants/data';
import { useMapStore } from '@/zustand/useMapStore';

// 目前 (情境 × 管制 × ratio) 對應的檔案組。所有資料 hook 都從這裡拿 url，
// 各 url 可能是 null（沒有該資料）——null 的處理（零列查詢 / 不建圖層）由各 hook 自己負責。
export const useResolvedFiles = (): FileSet => {
  const { scenarioType, networkControl, ratio } = useMapStore(
    useShallow((s) => ({
      scenarioType: s.scenarioType,
      networkControl: s.networkControl,
      ratio: s.ratio,
    })),
  );
  return useMemo(
    () => resolveFiles({ scenario: scenarioType, control: networkControl ? 'network_control' : 'none', ratio }),
    [scenarioType, networkControl, ratio],
  );
};
