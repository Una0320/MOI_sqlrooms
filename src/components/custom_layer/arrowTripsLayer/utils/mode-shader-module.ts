import { AGENT_MODE_TRIP_COLORS } from '@/constants/map';
import { ShaderModule } from '@luma.gl/shadertools';

export type ModeObjectProps = {
  bitmask: number // 這是單一的值
  colorMap: number[]
}
const _color_numbers = AGENT_MODE_TRIP_COLORS.length

/**
 * 
 *   
 * // vec4 colorMap2[5] = vec4[5](
  //     vec4(0.0, 0.0, 1.0, 1.0),
  //     vec4(0.0, 1.0, 0.0, 1.0),
  //     vec4(1.0, 0.0, 0.0, 1.0),
  //     vec4(0.2, 0.2, 0.2, 1.0),
  //     vec4(0.5, 0.0, 1.0, 0.7)
  //   );

 * 
 */

const uniformBlock = `
  uniform modeObjectUniforms {
    float bitmask;
    vec4 colorMap[${_color_numbers}];
  } modeObject;
`

// vertex shader 
const vertex = `
  // 從 accessor get data
  in highp float mode_type;

  // 這是 vs 要傳給 fs 的 data
  out highp float bitmask_isVisible;
  out highp float v_mode_type;
`
// fragment shader
const fragment = `
  // 接收來自 vs 的 value
  in highp float bitmask_isVisible;
  in highp float v_mode_type;
  
  vec4 get_color_by_mode_ext(vec4 color) {
    int index = int(log2(v_mode_type));
    vec4 color_from_map = vec4(1.0, 1.0, 1.0, 1.0);
    
    if(index >= 0 && index < ${_color_numbers}){
      color_from_map = modeObject.colorMap[index];
    }

    return color_from_map;
  }
`

const vs = `
${uniformBlock}
${vertex}
`

const fs = `
${uniformBlock}
${fragment}
`

const inject = {
  // 在 Vertex Shader 主程式開始時計算可見性
  'vs:#main-start': `
    bool visible = (uint(modeObject.bitmask) & uint(mode_type)) != 0u;

    // --- 傳給 fs ---
    bitmask_isVisible = visible ? 1.0 : 0.0;
    v_mode_type = mode_type;
  `,
  
  // 在 Fragment Shader 著色前最後檢查
  'fs:DECKGL_FILTER_COLOR': `
    if (bitmask_isVisible < 0.5) discard;
    // 1. 先取得顏色表裡的顏色
    vec4 mapped_color = get_color_by_mode_ext(color);
    
    // 🔥 2. 保留 RGB，但把透明度 (mapped_color.a) 與原本的透明度 (color.a) 相乘！
    // 這樣 TripsLayer 算好的漸層就會完美保留下來。
    color = vec4(mapped_color.rgb, mapped_color.a * color.a);
  `
}

export const modeObjectUniforms = {
  name: "modeObject",
  vs: vs,
  fs: fs,
  inject: inject,
  uniformTypes: {
    // TODO: 更改到 uint
    bitmask: 'f32',
    // bitmask: 'u32',
    //@ts-ignore // 不知道為什麼會報錯 但是不這樣寫 shader module 無法辨識 input value
    colorMap: 'vec4<f32>'
  },
} as const satisfies ShaderModule<ModeObjectProps>
