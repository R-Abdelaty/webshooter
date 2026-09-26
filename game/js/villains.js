(function(global){'use strict';
// targets are weak spots as fractions of the sprite, from its top left.
// height is how tall the sprite stands in the 3D city, in metres (real scale;
// the goblin's includes the disc he rides), and aspect is the PNG's width over
// its height, so the 3D game can place weak spots without loading the image.
global.VILLAINS=[
{id:'goblin',name:'GREEN GOBLIN',sprite:'assets/villains/goblin.png',height:2.4,aspect:680/1162,targets:[{name:'CHEST',x:.50,y:.39},{name:'HEAD',x:.46,y:.14},{name:'SHOULDER',x:.66,y:.28}]},
{id:'rhino',name:'RHINO',sprite:'assets/villains/rhino.png',height:2.9,aspect:651/613,targets:[{name:'CHEST',x:.51,y:.39},{name:'HEAD',x:.54,y:.25},{name:'SHOULDER',x:.28,y:.19}]},
{id:'venom',name:'VENOM',sprite:'assets/villains/venom.png',height:2.5,aspect:448/639,targets:[{name:'CHEST',x:.48,y:.46},{name:'HEAD',x:.43,y:.25},{name:'SHOULDER',x:.67,y:.43}]}];
if(typeof module!=='undefined')module.exports=global.VILLAINS;
})(typeof window==='undefined'?globalThis:window);
