#!/bin/bash
# Woods promo — different look from the city cut: forest green/amber palette,
# lowercase top-left captions, film grain + vignette, brand held to the end card.
set -e
cd "$(dirname "$0")"
FF=$(node -e "process.stdout.write(require('ffmpeg-static'))")
FONT="/System/Library/Fonts/Supplemental/Courier New Bold.ttf"

# total = 3.0 (title) + 31.03 (main) + 3.5 (end) = 37.53
"$FF" -y -hide_banner -loglevel error \
  -f lavfi -i "color=c=0x08140c:s=1920x1080:r=60:d=3.0" \
  -i woods-fixed.webm \
  -f lavfi -i "color=c=0x08140c:s=1920x1080:r=60:d=3.5" \
  -i woods-music.wav \
  -filter_complex "
[0:v]
 drawtext=fontfile='$FONT':text='the woods are open':fontsize=96:fontcolor=0xfff5e6:x=(w-text_w)/2:y=(h-text_h)/2-60,
 drawtext=fontfile='$FONT':text='nostr district · beyond the neon':fontsize=38:fontcolor=0xf0b040:x=(w-text_w)/2:y=(h-text_h)/2+58,
 fade=t=in:st=0:d=0.7,fade=t=out:st=2.4:d=0.6
[title];
[1:v]
 scale=1600:960:flags=neighbor,
 pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x08140c,
 vignette=angle=PI/5,
 noise=alls=3:allf=t,
 drawtext=fontfile='$FONT':text='walk past the edge of the city':fontsize=36:fontcolor=0xf0b040:box=1:boxcolor=0x08140c@0.6:boxborderw=14:x=140:y=130:enable='between(t,1.0,4.6)',
 drawtext=fontfile='$FONT':text='moonlit woods · fireflies · campfire':fontsize=36:fontcolor=0xf0b040:box=1:boxcolor=0x08140c@0.6:boxborderw=14:x=140:y=130:enable='between(t,6.5,11.0)',
 drawtext=fontfile='$FONT':text='cast a line — legends in the water':fontsize=36:fontcolor=0xf0b040:box=1:boxcolor=0x08140c@0.6:boxborderw=14:x=140:y=130:enable='between(t,17.5,22.5)',
 drawtext=fontfile='$FONT':text='a cabin to call home':fontsize=36:fontcolor=0xf0b040:box=1:boxcolor=0x08140c@0.6:boxborderw=14:x=140:y=130:enable='between(t,26.8,30.6)',
 fade=t=in:st=0:d=0.4
[main];
[2:v]
 drawtext=fontfile='$FONT':text='thedistrict.online':fontsize=88:fontcolor=0xf0b040:x=(w-text_w)/2:y=(h-text_h)/2-52,
 drawtext=fontfile='$FONT':text='touch grass · keep your keys':fontsize=38:fontcolor=0xfff5e6:x=(w-text_w)/2:y=(h-text_h)/2+56,
 fade=t=in:st=0:d=0.5,fade=t=out:st=3.0:d=0.5
[end];
[title][main][end]concat=n=3:v=1:a=0[v];
[3:a]atrim=0:37.53,afade=t=out:st=35.5:d=2.0,volume=0.9[a]
" \
  -map "[v]" -map "[a]" \
  -c:v libx264 -crf 22 -preset medium -pix_fmt yuv420p -r 60 \
  -c:a aac -b:a 192k -movflags +faststart \
  nostr-district-woods-promo.mp4

echo "done:"
ls -la nostr-district-woods-promo.mp4
