# Audio SFX synthesis params (jsfxr)

Reproduce any of the synthesized SFX with:

```bash
cd /tmp && npm i jsfxr
node -e "
const sfxr = require('jsfxr'); const fs = require('fs');
const params = new sfxr.Params();
params.fromJSON(JSON.parse(process.argv[1]));
const sound = new sfxr.SoundEffect(params).generate();
const m = sound.dataURI.match(/^data:.+\/(.+);base64,(.*)$/);
fs.writeFileSync('out.wav', Buffer.from(m[2], 'base64'));
" '<PARAMS_JSON>'
ffmpeg -i out.wav -codec:a libmp3lame -qscale:a 4 out.mp3
```

All: sample_rate 22050, mono.

| file | params JSON |
|---|---|
| jump.mp3 | `{"wave_type":0,"p_env_attack":0,"p_env_sustain":0.03,"p_env_decay":0.45,"p_env_punch":0.25,"p_base_freq":0.25,"p_freq_ramp":0.5,"p_duty":0.5,"sample_rate":22050,"sound_vol":0.5}` |
| dash.mp3 | `{"wave_type":1,"p_env_attack":0.01,"p_env_sustain":0.02,"p_env_decay":0.4,"p_base_freq":0.6,"p_freq_ramp":-0.45,"p_hpf_freq":0.15,"sample_rate":22050,"sound_vol":0.5}` |
| whiff.mp3 | `{"wave_type":3,"p_env_attack":0,"p_env_sustain":0.02,"p_env_decay":0.3,"p_base_freq":0.7,"p_freq_ramp":-0.5,"p_hpf_freq":0.25,"p_lpf_freq":0.6,"sample_rate":22050,"sound_vol":0.45}` |
| cast-fire.mp3 | `{"wave_type":3,"p_env_attack":0.02,"p_env_sustain":0.08,"p_env_decay":0.55,"p_base_freq":0.35,"p_freq_ramp":-0.22,"p_lpf_freq":0.35,"sample_rate":22050,"sound_vol":0.6}` |
| cast-ice.mp3 | `{"wave_type":2,"p_env_attack":0.01,"p_env_sustain":0.05,"p_env_decay":0.55,"p_base_freq":0.62,"p_freq_ramp":0.28,"p_vib_strength":0.35,"p_vib_speed":0.45,"sample_rate":22050,"sound_vol":0.5}` |

Kenney/OpenGameArt conversions are plain `ffmpeg -i src.ogg -codec:a libmp3lame -qscale:a 4 out.mp3`
(with the fade/echo variants noted in public/assets/CREDITS.txt).
