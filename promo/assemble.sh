#!/bin/bash
set -e
cd "$(dirname "$0")"
FF=$(node -e "process.stdout.write(require('ffmpeg-static'))")
FONT="/System/Library/Fonts/Supplemental/Courier New Bold.ttf"

"$FF" -y -hide_banner -loglevel error \
  -f lavfi -i "color=c=0x0a0014:s=1920x1080:r=60:d=2.8" \
  -i promo-fixed.webm \
  -f lavfi -i "color=c=0x0a0014:s=1920x1080:r=60:d=3.5" \
  -i promo-music.wav \
  -filter_complex "
[0:v]
 drawtext=fontfile='$FONT':text='NOSTR DISTRICT':fontsize=118:fontcolor=0xff71ce:x=(w-text_w)/2:y=(h-text_h)/2-70,
 drawtext=fontfile='$FONT':text='a pixel city on nostr':fontsize=44:fontcolor=0xfff5e6:x=(w-text_w)/2:y=(h-text_h)/2+60,
 fade=t=in:st=0:d=0.5,fade=t=out:st=2.3:d=0.5
[title];
[1:v]
 scale=1600:960:flags=neighbor,
 pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0a0014,
 drawtext=fontfile='$FONT':text='a neon pixel city — every citizen a keypair':fontsize=40:fontcolor=0xfff5e6:box=1:boxcolor=0x0a0014@0.65:boxborderw=16:x=(w-text_w)/2:y=h-140:enable='between(t,1.0,5.5)',
 drawtext=fontfile='$FONT':text='emote · chat · zap':fontsize=40:fontcolor=0x5dcaa5:box=1:boxcolor=0x0a0014@0.65:boxborderw=16:x=(w-text_w)/2:y=h-140:enable='between(t,7.8,11.2)',
 drawtext=fontfile='$FONT':text='bazaar · polls · crews · fishing':fontsize=40:fontcolor=0xf0b040:box=1:boxcolor=0x0a0014@0.65:boxborderw=16:x=(w-text_w)/2:y=h-140:enable='between(t,11.8,15.8)',
 drawtext=fontfile='$FONT':text='lounges, rooms — and your own pad':fontsize=40:fontcolor=0xff71ce:box=1:boxcolor=0x0a0014@0.65:boxborderw=16:x=(w-text_w)/2:y=h-140:enable='between(t,22.0,27.2)',
 fade=t=in:st=0:d=0.3
[main];
[2:v]
 drawtext=fontfile='$FONT':text='thedistrict.online':fontsize=92:fontcolor=0x5dcaa5:x=(w-text_w)/2:y=(h-text_h)/2-55:enable='gte(t,0)',
 drawtext=fontfile='$FONT':text='your keys · your city':fontsize=40:fontcolor=0xfff5e6:x=(w-text_w)/2:y=(h-text_h)/2+55,
 fade=t=in:st=0:d=0.4,fade=t=out:st=3.0:d=0.5
[end];
[title][main][end]concat=n=3:v=1:a=0[v];
[3:a]atrim=0:34.53,afade=t=out:st=32.8:d=1.7,volume=0.9[a]
" \
  -map "[v]" -map "[a]" \
  -c:v libx264 -crf 18 -preset medium -pix_fmt yuv420p -r 60 \
  -c:a aac -b:a 192k -movflags +faststart \
  nostr-district-promo.mp4

echo "done:"
ls -la nostr-district-promo.mp4
