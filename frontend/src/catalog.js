export const PRESETS = [
  {title:'청소기 돌리기',group:'청소',room:'집 전체·여러 공간',interval_days:7,kind:'general'},
  {title:'바닥 닦기',group:'청소',room:'집 전체·여러 공간',interval_days:7,kind:'general'},
  {title:'욕실 청소',group:'청소',room:'욕실',interval_days:7,kind:'general'},
  {title:'욕실 물기 닦기',group:'청소',room:'욕실',interval_days:1,kind:'bathroom'},
  {title:'싱크대·거름망 청소',group:'청소',room:'주방',interval_days:7,kind:'general'},
  {title:'침구 세탁',group:'세탁',room:'방·생활 공간',interval_days:14,kind:'laundry_indoor'},
  {title:'수건·옷 세탁',group:'세탁',room:'베란다·다용도실',interval_days:7,kind:'laundry_indoor'},
  ...['음식물 쓰레기 배출','일반 쓰레기 배출','재활용 배출'].map(title=>({title,group:'쓰레기',room:'집 전체·여러 공간',interval_days:7,kind:'waste',repeat_mode:'weekly',weekdays:[]})),
  {title:'냉장고 음식 확인',group:'기타 관리',room:'주방',interval_days:3,kind:'general'},
  {title:'손잡이·스위치 닦기',group:'기타 관리',room:'집 전체·여러 공간',interval_days:7,kind:'general'},
  {title:'가전 필터 점검',group:'기타 관리',room:'방·생활 공간',interval_days:30,kind:'filter'},
];
