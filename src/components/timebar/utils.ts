
export const formatDurationTo24Hour = (milliseconds: number) => {
  if (!milliseconds) return "00:00:00"

  const totalSeconds = Math.floor(milliseconds / 1000)
  
  // 計算時、分、秒
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  // 補零 Helper
  const pad = (num: number) => num.toString().padStart(2, '0')
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}
