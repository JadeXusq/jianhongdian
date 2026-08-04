/**
 * 生成 Cocos Creator 3.8 场景与脚本 meta。
 *
 * 为什么要生成而不是手写：.scene 是扁平数组 + __id__ 交叉引用的序列化格式，
 * 手写极易出错；脚本组件的 __type__ 还必须是脚本 uuid 的压缩形式。
 * 这里用固定 uuid，保证 meta 与场景引用永远一致，可重复生成。
 *
 * 运行：node tools/genCocosScene.mjs
 */
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { compressUuid } from "./cocosUuid.mjs";

const ROOT = join(import.meta.dirname, "..", "cocos");

/** 固定 uuid：场景、脚本、目录 */
const UUID = {
  scene: "a1b2c3d4-1111-4222-8333-444455556661",
  gameEntry: "a1b2c3d4-1111-4222-8333-444455556662",
  assetsScene: "a1b2c3d4-1111-4222-8333-444455556663",
  assetsScripts: "a1b2c3d4-1111-4222-8333-444455556664",
};

const vec3 = (x = 0, y = 0, z = 0) => ({ __type__: "cc.Vec3", x, y, z });
const quat = () => ({ __type__: "cc.Quat", x: 0, y: 0, z: 0, w: 1 });
const color = (r, g, b, a = 255) => ({ __type__: "cc.Color", r, g, b, a });

let idSeq = 0;
const nextId = () =>
  `${(idSeq++).toString(36).padStart(5, "0")}xxxxxxxxxxxxxxxxx`.slice(0, 22);

/** UI 节点的 layer：UI_2D = 1 << 25 */
const LAYER_UI = 33554432;

/**
 * 场景结构：
 * Scene
 *  └─ Canvas (UITransform + Canvas + Widget)
 *       ├─ Camera (Camera，UI 正交相机)
 *       └─ Game   (UITransform + GameEntry 脚本)
 */
function buildScene() {
  const a = [];
  const push = (o) => (a.push(o), a.length - 1);

  push({
    __type__: "cc.SceneAsset",
    _name: "",
    _objFlags: 0,
    __editorExtras__: {},
    _native: "",
    scene: { __id__: 1 },
  });

  const sceneIdx = push(null); // 占位，稍后回填
  const canvasIdx = push(null);
  const cameraNodeIdx = push(null);
  const gameNodeIdx = push(null);

  // Canvas 的组件
  const canvasUiTransform = push({
    __type__: "cc.UITransform",
    _name: "",
    _objFlags: 0,
    node: { __id__: canvasIdx },
    _enabled: true,
    __prefab: null,
    _contentSize: { __type__: "cc.Size", width: 1280, height: 720 },
    _anchorPoint: { __type__: "cc.Vec2", x: 0.5, y: 0.5 },
    _id: "",
  });
  const canvasComp = push({
    __type__: "cc.Canvas",
    _name: "",
    _objFlags: 0,
    node: { __id__: canvasIdx },
    _enabled: true,
    __prefab: null,
    _cameraComponent: { __id__: 6 }, // Camera 组件的 __id__，下面校验
    _alignCanvasWithScreen: true,
    _id: "",
  });
  const canvasWidget = push({
    __type__: "cc.Widget",
    _name: "",
    _objFlags: 0,
    node: { __id__: canvasIdx },
    _enabled: true,
    __prefab: null,
    _alignFlags: 45,
    _target: null,
    _left: 0,
    _right: 0,
    _top: 0,
    _bottom: 0,
    _horizontalCenter: 0,
    _verticalCenter: 0,
    _isAbsLeft: true,
    _isAbsRight: true,
    _isAbsTop: true,
    _isAbsBottom: true,
    _isAbsHorizontalCenter: true,
    _isAbsVerticalCenter: true,
    _originalWidth: 0,
    _originalHeight: 0,
    _alignMode: 2,
    _lockFlags: 0,
    _id: "",
  });

  // Camera 组件
  const cameraComp = push({
    __type__: "cc.Camera",
    _name: "",
    _objFlags: 0,
    node: { __id__: cameraNodeIdx },
    _enabled: true,
    __prefab: null,
    _projection: 0, // 正交
    _priority: 1073741824,
    _fov: 45,
    _fovAxis: 0,
    _orthoHeight: 360,
    _near: 1,
    _far: 2000,
    _color: color(0, 0, 0, 255),
    _depth: 1,
    _stencil: 0,
    _clearFlags: 7,
    _rect: { __type__: "cc.Rect", x: 0, y: 0, width: 1, height: 1 },
    _aperture: 19,
    _shutter: 7,
    _iso: 0,
    _screenScale: 1,
    _visibility: LAYER_UI,
    _targetTexture: null,
    _postProcess: null,
    _usePostProcess: false,
    _cameraType: -1,
    _trackingType: 0,
    _id: "",
  });

  // Game 节点上的组件
  const gameTransform = push({
    __type__: "cc.UITransform",
    _name: "",
    _objFlags: 0,
    node: { __id__: gameNodeIdx },
    _enabled: true,
    __prefab: null,
    _contentSize: { __type__: "cc.Size", width: 0, height: 0 },
    _anchorPoint: { __type__: "cc.Vec2", x: 0.5, y: 0.5 },
    _id: "",
  });
  const gameScript = push({
    __type__: compressUuid(UUID.gameEntry),
    _name: "",
    _objFlags: 0,
    node: { __id__: gameNodeIdx },
    _enabled: true,
    __prefab: null,
    _id: "",
  });

  const globalsIdx = push(buildSceneGlobals());

  // 回填
  a[sceneIdx] = {
    __type__: "cc.Scene",
    _name: "main",
    _objFlags: 0,
    __editorExtras__: {},
    _parent: null,
    _children: [{ __id__: canvasIdx }],
    _active: true,
    _components: [],
    _prefab: null,
    _lpos: vec3(),
    _lrot: quat(),
    _lscale: vec3(1, 1, 1),
    _mobility: 0,
    _layer: 1073741824,
    _euler: vec3(),
    autoReleaseAssets: false,
    _globals: { __id__: globalsIdx },
    _id: UUID.scene,
  };

  a[canvasIdx] = node(
    "Canvas",
    sceneIdx,
    [cameraNodeIdx, gameNodeIdx],
    [canvasUiTransform, canvasComp, canvasWidget]
  );
  a[cameraNodeIdx] = node(
    "Camera",
    canvasIdx,
    [],
    [cameraComp],
    vec3(0, 0, 1000)
  );
  a[gameNodeIdx] = node("Game", canvasIdx, [], [gameTransform, gameScript]);

  // Canvas._cameraComponent 必须指向 Camera 组件的真实下标
  a[canvasComp]._cameraComponent = { __id__: cameraComp };
  return a;
}

function node(name, parentIdx, childIdx, compIdx, lpos = vec3()) {
  return {
    __type__: "cc.Node",
    _name: name,
    _objFlags: 0,
    __editorExtras__: {},
    _parent: { __id__: parentIdx },
    _children: childIdx.map((i) => ({ __id__: i })),
    _active: true,
    _components: compIdx.map((i) => ({ __id__: i })),
    _prefab: null,
    _lpos: lpos,
    _lrot: quat(),
    _lscale: vec3(1, 1, 1),
    _mobility: 0,
    _layer: LAYER_UI,
    _euler: vec3(),
    _id: nextId(),
  };
}

/** 场景全局设置：2D 项目用最简配置即可 */
function buildSceneGlobals() {
  return {
    __type__: "cc.SceneGlobals",
    ambient: {
      __type__: "cc.AmbientInfo",
      _skyColorHDR: {
        __type__: "cc.Vec4",
        x: 0.2,
        y: 0.5,
        z: 0.8,
        w: 0.520833,
      },
      _skyColor: { __type__: "cc.Vec4", x: 0.2, y: 0.5, z: 0.8, w: 0.520833 },
      _skyIllumHDR: 20000,
      _skyIllum: 20000,
      _groundAlbedoHDR: { __type__: "cc.Vec4", x: 0.2, y: 0.2, z: 0.2, w: 1 },
      _groundAlbedo: { __type__: "cc.Vec4", x: 0.2, y: 0.2, z: 0.2, w: 1 },
      _skyColorLDR: {
        __type__: "cc.Vec4",
        x: 0.452588,
        y: 0.607642,
        z: 0.755699,
        w: 0,
      },
      _skyIllumLDR: 0.8,
      _groundAlbedoLDR: {
        __type__: "cc.Vec4",
        x: 0.618555,
        y: 0.577848,
        z: 0.544564,
        w: 0,
      },
    },
    shadows: {
      __type__: "cc.ShadowsInfo",
      _enabled: false,
      _type: 0,
      _normal: vec3(0, 1, 0),
      _distance: 0,
      _shadowColor: color(76, 76, 76, 255),
      _maxReceived: 4,
      _size: { __type__: "cc.Vec2", x: 512, y: 512 },
    },
    _skybox: {
      __type__: "cc.SkyboxInfo",
      _envLightingType: 0,
      _envmapHDR: null,
      _envmap: null,
      _envmapLDR: null,
      _diffuseMapHDR: null,
      _diffuseMapLDR: null,
      _enabled: false,
      _useHDR: true,
      _editableMaterial: null,
      _reflectionHDR: null,
      _reflectionLDR: null,
      _rotationAngle: 0,
    },
    fog: {
      __type__: "cc.FogInfo",
      _type: 0,
      _fogColor: color(200, 200, 200, 255),
      _enabled: false,
      _fogDensity: 0.3,
      _fogStart: 0.5,
      _fogEnd: 300,
      _fogAtten: 5,
      _fogTop: 1.5,
      _fogRange: 1.2,
      _accurate: false,
    },
    octree: {
      __type__: "cc.OctreeInfo",
      _enabled: false,
      _minPos: vec3(-1024, -1024, -1024),
      _maxPos: vec3(1024, 1024, 1024),
      _depth: 8,
    },
    skin: {
      __type__: "cc.SkinInfo",
      _enabled: false,
      _blurRadius: 0.01,
      _sssIntensity: 3,
    },
    lightProbeInfo: {
      __type__: "cc.LightProbeInfo",
      _giScale: 1,
      _giSamples: 1024,
      _bounces: 2,
      _reduceRinging: 0,
      _showProbe: true,
      _showWireframe: true,
      _showConvex: false,
      _data: null,
      _lightProbeSphereVolume: 1,
    },
    postSettings: { __type__: "cc.PostSettingsInfo", _toneMappingType: 0 },
    bakedWithStationaryMainLight: false,
    bakedWithHighpLightmap: false,
  };
}

// ---------- 写盘 ----------

function write(path, content) {
  const full = join(ROOT, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  console.log("写入", path);
}

const scene = buildScene();
write("assets/scene/main.scene", JSON.stringify(scene, null, 2));

write(
  "assets/scene/main.scene.meta",
  JSON.stringify(
    {
      ver: "1.1.50",
      importer: "scene",
      imported: true,
      uuid: UUID.scene,
      files: [".json"],
      subMetas: {},
      userData: {},
    },
    null,
    2
  )
);

write(
  "assets/scene.meta",
  JSON.stringify(
    {
      ver: "1.2.0",
      importer: "directory",
      imported: true,
      uuid: UUID.assetsScene,
      files: [],
      subMetas: {},
      userData: {},
    },
    null,
    2
  )
);

write(
  "assets/scripts.meta",
  JSON.stringify(
    {
      ver: "1.2.0",
      importer: "directory",
      imported: true,
      uuid: UUID.assetsScripts,
      files: [],
      subMetas: {},
      userData: {},
    },
    null,
    2
  )
);

write(
  "assets/scripts/GameEntry.ts.meta",
  JSON.stringify(
    {
      ver: "4.0.24",
      importer: "typescript",
      imported: true,
      uuid: UUID.gameEntry,
      files: [],
      subMetas: {},
      userData: {},
    },
    null,
    2
  )
);

console.log("\n场景条目数:", scene.length);
console.log("GameEntry 压缩 uuid:", compressUuid(UUID.gameEntry));
