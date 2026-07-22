package com.atlasgtnh.icondumper;

import cpw.mods.fml.common.FMLCommonHandler;
import cpw.mods.fml.common.Loader;
import cpw.mods.fml.common.ModContainer;
import cpw.mods.fml.common.Mod;
import cpw.mods.fml.common.Mod.EventHandler;
import cpw.mods.fml.common.event.FMLPreInitializationEvent;
import cpw.mods.fml.common.eventhandler.SubscribeEvent;
import cpw.mods.fml.common.gameevent.TickEvent;
import cpw.mods.fml.common.registry.FMLControlledNamespacedRegistry;
import cpw.mods.fml.common.registry.GameData;
import cpw.mods.fml.common.registry.GameRegistry;
import net.minecraftforge.client.event.TextureStitchEvent;
import net.minecraftforge.common.MinecraftForge;

import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Array;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.text.SimpleDateFormat;
import java.util.*;
import javax.imageio.ImageIO;

/**
 * Atlas GTNH — Icon Dumper Mod
 *
 * Intercepts the post-texture-stitch event (fires after all registerBlockIcons()
 * calls complete) and calls block.getIcon(side, meta) via reflection for every
 * registered block × meta 0-15 × side 0-5.
 *
 * Uses reflection exclusively for vanilla MC class calls so the mod compiles
 * against only the Forge universal JAR without needing a deobfuscated MC JAR.
 * At runtime Forge's LaunchClassLoader deobfuscates vanilla classes to MCP names,
 * so reflection lookups by MCP name ("getIcon", "getIconName", etc.) succeed.
 *
 * Output: {gameDir}/config/atlas/icon_dump.json, biome_dump.json,
 *         ore_vein_dump.json, rotation_dump.json
 * Format: atlas-gtnh-icon-dump-v1
 */
@Mod(
    modid   = AtlasDumper.MOD_ID,
    name    = "Atlas Dumper",
    version = AtlasDumper.VERSION,
    acceptedMinecraftVersions = "[1.7.10]"
)
public class AtlasDumper {

    public static final String MOD_ID  = "atlas_dumper";
    public static final String VERSION = "1.5.1";

    private File gameDir;
    // Guard: TextureStitchEvent.Post fires twice (blocks atlas, then items atlas).
    // We dump on the first fire (blocks atlas is always stitched first).
    private boolean dumped = false;
    // Biome colors are dumped separately, on the first client tick with a loaded
    // world — by then the grass/foliage colormaps that getBiomeGrassColor reads
    // are loaded (they are not guaranteed at texture-stitch time).
    private boolean biomesDumped = false;
    // Ore veins are dumped on the same world-load gate. GregTech's OreMixes /
    // Materials registry and its ore-block icons are only fully initialized well
    // after the (early) texture stitch, so dumping at stitch time throws an Error
    // from the enum's static init and silently fails — wait for a loaded world.
    private boolean oreVeinsDumped = false;
    // Tile-entity NBT schemas, for re-facing machines in a rotated paste.
    private boolean rotationsDumped = false;

    // Resolved once on first dump; cached for the life of the process.
    private Method getIconMethod     = null;  // Block.getIcon(int, int) → IIcon
    private Method getIconNameMethod = null;  // IIcon.getIconName() → String
    private Method getNameMethod     = null;  // Registry.getNameForObject(Object) → String

    @EventHandler
    public void preInit(FMLPreInitializationEvent event) {
        this.gameDir = event.getModConfigurationDirectory().getParentFile();
        MinecraftForge.EVENT_BUS.register(this);          // TextureStitchEvent (block icons)
        FMLCommonHandler.instance().bus().register(this); // ClientTickEvent (biomes + ore veins)
        System.out.println("[AtlasDumper] Registered — will dump icons after blocks texture stitch, biomes + ore veins after world load.");
    }

    @SubscribeEvent
    public void onTextureStitchPost(TextureStitchEvent.Post event) {
        if (dumped) return;
        dumped = true;
        System.out.println("[AtlasDumper] Texture atlas stitched — starting icon dump...");
        dumpIcons();
    }

    @SubscribeEvent
    public void onClientTick(TickEvent.ClientTickEvent event) {
        if (biomesDumped && oreVeinsDumped && rotationsDumped) return;

        // Tile-entity schemas need no world — the registry is filled during mod
        // init — so this runs at the main menu. Making people load a save to
        // collect it would be a gate with nothing behind it.
        if (!rotationsDumped) {
            rotationsDumped = true;
            System.out.println("[AtlasDumper] Starting rotation dump...");
            dumpRotations(); // tile-entity NBT schemas, so a rotated paste can re-face machines
        }

        // The rest do need a world: the grass/foliage colormaps (biomes) and the
        // fully-baked GregTech OreMixes / Materials / ore-block icons (ore veins)
        // are only guaranteed once a world is in — not at texture-stitch time.
        if (getClientWorld() == null) return;
        if (!biomesDumped) {
            biomesDumped = true;
            System.out.println("[AtlasDumper] World loaded — starting biome color dump...");
            dumpBiomes();
        }
        if (!oreVeinsDumped) {
            oreVeinsDumped = true;
            System.out.println("[AtlasDumper] World loaded — starting ore-vein dump...");
            dumpOreVeins(); // GregTech ore-vein registry (name + representative ore texture + colour)
        }
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private void dumpIcons() {
        // ── Resolve reflection handles ────────────────────────────────────────
        // Forge's runtime deobfuscation maps vanilla class names to their MCP
        // package (net.minecraft.block.Block) but keeps method names at the SRG
        // level (func_149691_a), NOT the human-readable MCP name (getIcon).
        // We try both so the mod works whether or not MCP names are applied.
        try {
            Class<?> blockClass = Class.forName("net.minecraft.block.Block");
            for (String name : new String[]{"getIcon", "func_149691_a"}) {
                try { getIconMethod = blockClass.getMethod(name, int.class, int.class); break; }
                catch (NoSuchMethodException ignored) {}
            }
            if (getIconMethod == null) throw new NoSuchMethodException("getIcon / func_149691_a not found on Block");

            Class<?> iIconClass = getIconMethod.getReturnType();
            for (String name : new String[]{"getIconName", "func_94215_i", "func_110472_a"}) {
                try { getIconNameMethod = iIconClass.getMethod(name); break; }
                catch (NoSuchMethodException ignored) {}
            }
            if (getIconNameMethod == null) throw new NoSuchMethodException("getIconName / func_94215_i not found on IIcon");
        } catch (Exception e) {
            System.err.println("[AtlasDumper] FATAL: could not resolve Block.getIcon / IIcon.getIconName via reflection: " + e);
            return;
        }

        // ── Collect data ──────────────────────────────────────────────────────
        Map<String, Map<String, Map<String, String>>> blocksMap = new LinkedHashMap<>();
        int totalBlocks     = 0;   // blocks with a resolved registry name
        int resolvedBlocks  = 0;   // blocks that produced at least one icon
        int skippedNoName   = 0;   // registry entries with no resolvable name
        int errorCount      = 0;
        List<String> errorSamples = new ArrayList<>();
        List<String> noIconNames  = new ArrayList<>();  // named but zero icons (full list)

        // Raw registry — generics erased at runtime, elements are Block at runtime.
        FMLControlledNamespacedRegistry blockReg = GameData.getBlockRegistry();

        // Resolve getNameForObject — try MCP name, SRG name, then scan by signature.
        // At runtime this is on the vanilla RegistryNamespaced superclass; its
        // name depends on how far Forge deobfuscates (SRG vs MCP).
        if (getNameMethod == null) {
            for (String name : new String[]{"getNameForObject", "func_148741_d"}) {
                try {
                    getNameMethod = blockReg.getClass().getMethod(name, Object.class);
                    break;
                } catch (NoSuchMethodException ignored) {}
            }
        }
        // Last resort: scan for a method that returns String and takes one Object
        if (getNameMethod == null) {
            for (Method m : blockReg.getClass().getMethods()) {
                if (m.getReturnType() == String.class &&
                    m.getParameterCount() == 1 &&
                    m.getParameterTypes()[0] == Object.class &&
                    !java.lang.reflect.Modifier.isStatic(m.getModifiers())) {
                    getNameMethod = m;
                    break;
                }
            }
        }

        // Build the full block set.  The registry iterator can silently miss
        // blocks in some Forge/GTNH builds (observed: ProjectRed's blocks never
        // appear despite the mod being loaded).  We union the iterator with a
        // direct id-scan via Block.getBlockById, which backstops any iterator
        // gap and catches every block reachable by ID.
        Set<Object> blockSet = Collections.newSetFromMap(new IdentityHashMap<Object, Boolean>());
        Iterator<?> iter = blockReg.iterator();
        while (iter.hasNext()) {
            Object b = iter.next();
            if (b != null) blockSet.add(b);
        }
        int iterCount = blockSet.size();

        // Resolve Block.getBlockById(int). At runtime Forge keeps SRG method
        // names, so try MCP + SRG, then fall back to a signature scan (the only
        // public static Block(int) method) so we don't depend on a hard-coded
        // SRG string being correct.
        String idScanMethod = "unresolved";
        Method getBlockById = null;
        try {
            Class<?> blockClass = Class.forName("net.minecraft.block.Block");
            for (String n : new String[]{"getBlockById", "func_149729_e"}) {
                try { getBlockById = blockClass.getMethod(n, int.class); idScanMethod = n; break; }
                catch (NoSuchMethodException ignored) {}
            }
            if (getBlockById == null) {
                for (Method m : blockClass.getMethods()) {
                    if (java.lang.reflect.Modifier.isStatic(m.getModifiers())
                        && m.getReturnType() == blockClass
                        && m.getParameterCount() == 1
                        && m.getParameterTypes()[0] == int.class) {
                        getBlockById = m;
                        idScanMethod = m.getName() + " (by signature)";
                        break;
                    }
                }
            }
        } catch (Exception ignored) {}

        if (getBlockById != null) {
            Object air = null;
            try { air = getBlockById.invoke(null, 0); } catch (Exception ignored) {}
            // GTNH uses extended block IDs well above the vanilla 4096 ceiling.
            for (int id = 1; id <= 32767; id++) {
                try {
                    Object b = getBlockById.invoke(null, id);
                    if (b != null && b != air) blockSet.add(b);
                } catch (Exception ignored) {}
            }
        }
        int idScanAdded = blockSet.size() - iterCount;
        System.out.printf("[AtlasDumper] registry iterator=%d, id-scan method=%s, id-scan added=%d%n",
            iterCount, idScanMethod, idScanAdded);

        for (Object block : blockSet) {
            String regName = getRegistryName(blockReg, block);
            if (regName == null || regName.isEmpty()) {
                skippedNoName++;
                continue;
            }

            totalBlocks++;
            Map<String, Map<String, String>> metaMap = new LinkedHashMap<>();

            for (int meta = 0; meta < 16; meta++) {
                Map<String, String> sideMap = new LinkedHashMap<>();

                for (int side = 0; side < 6; side++) {
                    try {
                        Object icon = getIconMethod.invoke(block, side, meta);
                        if (icon == null) continue;
                        String iconName = (String) getIconNameMethod.invoke(icon);
                        if (iconName != null && !iconName.isEmpty()) {
                            sideMap.put(String.valueOf(side), iconName);
                        }
                    } catch (Exception e) {
                        errorCount++;
                        if (errorSamples.size() < 50) {
                            Throwable cause = (e.getCause() != null) ? e.getCause() : e;
                            errorSamples.add(regName + " m=" + meta + " s=" + side
                                + " → " + cause.getClass().getSimpleName()
                                + (cause.getMessage() != null ? ": " + cause.getMessage().split("\n")[0] : ""));
                        }
                    }
                }

                if (!sideMap.isEmpty()) {
                    metaMap.put(String.valueOf(meta), sideMap);
                }
            }

            if (!metaMap.isEmpty()) {
                blocksMap.put(regName, metaMap);
                resolvedBlocks++;
            } else {
                // Full list (not capped): these blocks are in the registry but
                // getIcon(side, meta) yielded nothing — the precise set Atlas
                // must resolve another way (render rules / legacy heuristics).
                noIconNames.add(regName);
            }
        }

        // Loaded mod list — lets Atlas diff a world's FML.ModList against the
        // dump and surface exactly which mods are absent (the usual cause of
        // "no mapping" blocks: the dump was built from a different pack build).
        List<String> modList = new ArrayList<>();
        try {
            for (ModContainer mc : Loader.instance().getActiveModList()) {
                modList.add(mc.getModId() + "@" + mc.getVersion());
            }
        } catch (Throwable t) {
            System.err.println("[AtlasDumper] Could not read mod list: " + t);
        }

        // ── Write output ──────────────────────────────────────────────────────
        File outDir = new File(gameDir, "config/atlas");
        if (!outDir.exists() && !outDir.mkdirs()) {
            System.err.println("[AtlasDumper] Could not create output directory: " + outDir);
            return;
        }
        File outFile = new File(outDir, "icon_dump.json");

        try (FileWriter w = new FileWriter(outFile)) {
            writeJson(w, blocksMap, totalBlocks, resolvedBlocks, skippedNoName,
                      errorCount, errorSamples, noIconNames, modList,
                      iterCount, idScanMethod, idScanAdded);
            System.out.printf(
                "[AtlasDumper] Done — %d/%d blocks (%d no-icon, %d unnamed), "
                + "%d mods, %d errors → %s%n",
                resolvedBlocks, totalBlocks, noIconNames.size(), skippedNoName,
                modList.size(), errorCount, outFile.getAbsolutePath());
        } catch (IOException e) {
            System.err.println("[AtlasDumper] Write failed: " + e.getMessage());
        }
    }

    /**
     * Get the "modid:name" registry string for a block.
     * Primary: GameRegistry.findUniqueIdentifierFor — a real Forge method name,
     * always available regardless of deobfuscation level.
     * Fallback: getNameForObject / func_148741_d on the registry superclass.
     */
    @SuppressWarnings("rawtypes")
    private String getRegistryName(FMLControlledNamespacedRegistry blockReg, Object block) {
        // Primary: GameRegistry.findUniqueIdentifierFor(Block block)
        // This is a Forge method with its real name; parameter type is Block at runtime.
        try {
            Class<?> baseBlockClass = block.getClass();
            while (baseBlockClass.getSuperclass() != null &&
                   !baseBlockClass.getName().equals("net.minecraft.block.Block")) {
                baseBlockClass = baseBlockClass.getSuperclass();
            }
            Method findUID = GameRegistry.class.getMethod("findUniqueIdentifierFor", baseBlockClass);
            Object uid = findUID.invoke(null, block);
            if (uid != null) {
                String modId = (String) uid.getClass().getField("modId").get(uid);
                String name  = (String) uid.getClass().getField("name").get(uid);
                return modId + ":" + name;
            }
        } catch (Exception ignored) {}

        // Fallback: getNameForObject / func_148741_d on the registry
        if (getNameMethod != null) {
            try {
                return (String) getNameMethod.invoke(blockReg, block);
            } catch (Exception ignored) {}
        }
        return null;
    }

    // ── Minimal hand-rolled JSON writer ──────────────────────────────────────

    private void writeJson(
        FileWriter w,
        Map<String, Map<String, Map<String, String>>> blocksMap,
        int total, int resolved, int skippedNoName, int errors,
        List<String> errorSamples, List<String> noIconNames, List<String> modList,
        int iterCount, String idScanMethod, int idScanAdded
    ) throws IOException {
        String ts = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new Date());

        w.write("{\n");
        w.write("  \"format\": \"atlas-gtnh-icon-dump-v1\",\n");
        w.write("  \"minecraft_version\": \"1.7.10\",\n");
        w.write("  \"generated_at\": " + jsonStr(ts) + ",\n");
        w.write("  \"summary\": {\n");
        w.write("    \"total_blocks\": "         + total         + ",\n");
        w.write("    \"blocks_with_icons\": "    + resolved      + ",\n");
        w.write("    \"blocks_without_icons\": " + (total - resolved) + ",\n");
        w.write("    \"skipped_no_name\": "      + skippedNoName  + ",\n");
        w.write("    \"registry_iter_count\": " + iterCount      + ",\n");
        w.write("    \"id_scan_method\": "       + jsonStr(idScanMethod) + ",\n");
        w.write("    \"id_scan_added\": "        + idScanAdded    + ",\n");
        w.write("    \"mod_count\": "            + modList.size() + ",\n");
        w.write("    \"errors\": "               + errors        + ",\n");
        w.write("    \"error_samples\": [");
        for (int i = 0; i < errorSamples.size(); i++) {
            if (i > 0) w.write(", ");
            w.write(jsonStr(errorSamples.get(i)));
        }
        w.write("],\n");
        w.write("    \"no_icon_blocks\": [");
        for (int i = 0; i < noIconNames.size(); i++) {
            if (i > 0) w.write(", ");
            w.write(jsonStr(noIconNames.get(i)));
        }
        w.write("]\n  },\n");

        // Loaded mods (modid@version) — for world↔dump mismatch detection.
        w.write("  \"mods\": [");
        for (int i = 0; i < modList.size(); i++) {
            if (i > 0) w.write(", ");
            w.write(jsonStr(modList.get(i)));
        }
        w.write("],\n");

        w.write("  \"blocks\": {\n");
        int bi = 0;
        for (Map.Entry<String, Map<String, Map<String, String>>> blockEntry : blocksMap.entrySet()) {
            if (bi++ > 0) w.write(",\n");
            w.write("    " + jsonStr(blockEntry.getKey()) + ": {\n");
            int mi = 0;
            for (Map.Entry<String, Map<String, String>> metaEntry : blockEntry.getValue().entrySet()) {
                if (mi++ > 0) w.write(",\n");
                w.write("      " + jsonStr(metaEntry.getKey()) + ": {");
                int si = 0;
                for (Map.Entry<String, String> sideEntry : metaEntry.getValue().entrySet()) {
                    if (si++ > 0) w.write(", ");
                    w.write(jsonStr(sideEntry.getKey()) + ": " + jsonStr(sideEntry.getValue()));
                }
                w.write("}");
            }
            w.write("\n    }");
        }
        w.write("\n  }\n}\n");
    }

    // ── Biome color dump ──────────────────────────────────────────────────────

    /** The client's loaded world, or null — via Minecraft.getMinecraft().theWorld. */
    private Object getClientWorld() {
        try {
            Class<?> mcClass = Class.forName("net.minecraft.client.Minecraft");
            Method getMc = resolveMethod(mcClass, new Class<?>[]{}, "getMinecraft", "func_71410_x");
            Object mc = getMc.invoke(null);
            if (mc == null) return null;
            Field theWorld = resolveField(mcClass, "theWorld", "field_71441_e");
            return theWorld.get(mc);
        } catch (Throwable t) {
            return null;
        }
    }

    /**
     * Dump each registered biome's real grass and foliage color — the same values
     * getBiomeGrassColor()/getBiomeFoliageColor() return in-game (colormap lookups
     * plus any mod override, e.g. BOP's fixed/perlin colors) — so Atlas can key
     * biome tint on ground truth instead of a hardcoded temperature/rainfall table.
     * Colors are sampled at (0,64,0): the biome's center color, not the 3x3 edge
     * average (Atlas re-derives border blending itself).
     */
    private void dumpBiomes() {
        Map<Integer, Object[]> biomes = new LinkedHashMap<>();  // id → [name, grass, foliage, temp, rain]
        int count = 0, errors = 0;
        List<String> errorSamples = new ArrayList<>();
        try {
            Class<?> biomeClass = Class.forName("net.minecraft.world.biome.BiomeGenBase");
            Method getArray = resolveMethod(biomeClass, new Class<?>[]{}, "getBiomeGenArray", "func_150565_n");
            Method getGrass = resolveMethod(biomeClass, new Class<?>[]{int.class, int.class, int.class}, "getBiomeGrassColor",   "func_150558_b");
            Method getFol   = resolveMethod(biomeClass, new Class<?>[]{int.class, int.class, int.class}, "getBiomeFoliageColor", "func_150571_c");
            Field  idField   = resolveField(biomeClass, "biomeID",   "field_76756_M");
            Field  nameField = resolveField(biomeClass, "biomeName", "field_76791_y");
            Field  tempField = resolveFieldOrNull(biomeClass, "temperature", "field_76750_F");
            Field  rainField = resolveFieldOrNull(biomeClass, "rainfall",    "field_76751_G");

            Object arr = getArray.invoke(null);   // BiomeGenBase[]
            int len = Array.getLength(arr);
            for (int i = 0; i < len; i++) {
                Object biome = Array.get(arr, i);
                if (biome == null) continue;
                try {
                    int id      = idField.getInt(biome);
                    String name = String.valueOf(nameField.get(biome));
                    int grass   = ((Number) getGrass.invoke(biome, 0, 64, 0)).intValue() & 0xFFFFFF;
                    int foliage = ((Number) getFol.invoke(biome, 0, 64, 0)).intValue() & 0xFFFFFF;
                    float temp  = tempField != null ? tempField.getFloat(biome) : 0f;
                    float rain  = rainField != null ? rainField.getFloat(biome) : 0f;
                    biomes.put(id, new Object[]{name, grass, foliage, temp, rain});
                    count++;
                } catch (Exception e) {
                    errors++;
                    if (errorSamples.size() < 30) {
                        Throwable c = (e.getCause() != null) ? e.getCause() : e;
                        errorSamples.add("biome[" + i + "] → " + c.getClass().getSimpleName()
                            + (c.getMessage() != null ? ": " + c.getMessage().split("\n")[0] : ""));
                    }
                }
            }
        } catch (Exception e) {
            System.err.println("[AtlasDumper] FATAL: biome dump reflection failed: " + e);
            return;
        }

        File outDir = new File(gameDir, "config/atlas");
        if (!outDir.exists() && !outDir.mkdirs()) {
            System.err.println("[AtlasDumper] Could not create output directory: " + outDir);
            return;
        }
        File outFile = new File(outDir, "biome_dump.json");
        try (FileWriter w = new FileWriter(outFile)) {
            writeBiomeJson(w, biomes, count, errors, errorSamples);
            System.out.printf("[AtlasDumper] Biome dump done — %d biomes, %d errors → %s%n",
                count, errors, outFile.getAbsolutePath());
        } catch (IOException e) {
            System.err.println("[AtlasDumper] Biome write failed: " + e.getMessage());
        }
    }

    private void writeBiomeJson(FileWriter w, Map<Integer, Object[]> biomes,
                                int count, int errors, List<String> errorSamples) throws IOException {
        String ts = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new Date());

        List<String> modList = new ArrayList<>();
        try {
            for (ModContainer mc : Loader.instance().getActiveModList()) {
                modList.add(mc.getModId() + "@" + mc.getVersion());
            }
        } catch (Throwable ignored) {}

        w.write("{\n");
        w.write("  \"format\": \"atlas-gtnh-biome-dump-v1\",\n");
        w.write("  \"minecraft_version\": \"1.7.10\",\n");
        w.write("  \"generated_at\": " + jsonStr(ts) + ",\n");
        w.write("  \"summary\": { \"biome_count\": " + count + ", \"errors\": " + errors + ", \"error_samples\": [");
        for (int i = 0; i < errorSamples.size(); i++) {
            if (i > 0) w.write(", ");
            w.write(jsonStr(errorSamples.get(i)));
        }
        w.write("] },\n");
        w.write("  \"mods\": [");
        for (int i = 0; i < modList.size(); i++) {
            if (i > 0) w.write(", ");
            w.write(jsonStr(modList.get(i)));
        }
        w.write("],\n");
        w.write("  \"biomes\": {\n");
        int bi = 0;
        for (Map.Entry<Integer, Object[]> e : biomes.entrySet()) {
            if (bi++ > 0) w.write(",\n");
            Object[] v = e.getValue();
            w.write("    \"" + e.getKey() + "\": { "
                + "\"name\": "        + jsonStr((String) v[0]) + ", "
                + "\"grass\": "       + ((Integer) v[1])       + ", "
                + "\"foliage\": "     + ((Integer) v[2])       + ", "
                + "\"temperature\": " + v[3]                   + ", "
                + "\"rainfall\": "    + v[4]                   + " }");
        }
        w.write("\n  }\n}\n");
    }

    /**
     * Dump the GregTech ore-vein registry so Atlas can label each Visual
     * Prospecting vein with GTNH's real name + representative-ore texture + colour.
     * VP keys veins by the ore-mix name ("ore.mix.gold"); we emit the same key
     * with { name (getLocalizedName), texture (representative ore's IIcon), rgb
     * (representative material colour, for tinting the grayscale ore overlay) }.
     *
     * Pure reflection into gregtech.* — GT is a mod (not SRG-mangled), so its real
     * names survive at runtime. Reuses the getIcon / getIconName handles resolved
     * by dumpIcons(). Runs from the block-atlas stitch, when ore icons are live.
     */
    @SuppressWarnings({"unchecked", "rawtypes"})
    private void dumpOreVeins() {
        if (getIconMethod == null || getIconNameMethod == null) {
            System.err.println("[AtlasDumper] Ore-vein dump skipped: icon handles unresolved.");
            return;
        }
        // ore.mix.X → [name, spriteKey|null, rgb, dims(List<String>)]
        Map<String, Object[]> veins = new LinkedHashMap<>();
        // iconName → base64 PNG of the ore overlay sprite (grayscale + alpha), deduped.
        Map<String, String> oreSprites = new LinkedHashMap<>();
        int count = 0, withTexture = 0, errors = 0;
        List<String> errorSamples = new ArrayList<>();
        // Per-step ore-sprite outcome histogram (insertion-ordered) — surfaced in the
        // dump summary so the exact failing/succeeding step is visible without the log.
        Map<String, Integer> spriteStats = new LinkedHashMap<>();
        // Sprite keys drawn from a coloured overlay (blank grayscale base) — the map
        // renders these as-is instead of tinting by the material rgb.
        Set<String> preColored = new LinkedHashSet<>();
        try {
            Class<?> oreMixesClass = Class.forName("gregtech.api.enums.OreMixes");
            Class<?> builderClass = Class.forName("gregtech.common.OreMixBuilder");
            Object[] mixes = oreMixesClass.getEnumConstants();
            if (mixes == null) throw new IllegalStateException("OreMixes has no enum constants");

            // Find the OreMixBuilder-typed field on the enum (name-independent).
            // Match either direction so a field declared as a supertype/interface of
            // OreMixBuilder still counts (the enum constants and $VALUES don't).
            Field builderField = null;
            for (Field f : oreMixesClass.getDeclaredFields()) {
                if (f.getType().isAssignableFrom(builderClass)
                        || builderClass.isAssignableFrom(f.getType())) {
                    builderField = f;
                    builderField.setAccessible(true);
                    break;
                }
            }
            if (builderField == null) throw new NoSuchFieldException("no OreMixBuilder field on OreMixes");

            // oreMixName is the VP palette key — the one field we truly need. The rest
            // are best-effort: resolve to null and degrade gracefully (rather than
            // aborting the whole dump) if a field/method name doesn't match this build.
            Field nameF = resolveField(builderClass, "oreMixName", "mOreMixName", "name");
            Field repF = resolveFieldOrNull(builderClass, "representative", "mRepresentative");
            Field dimsF = resolveFieldOrNull(builderClass, "dimsEnabled", "allowedDimWorlds", "dims");
            Method locNameM = resolveMethodOrNull(builderClass, "getLocalizedName", "localizedName");
            // getRGBA() is declared on each material's OWN class — vanilla-GT Materials,
            // gtPlusPlus Material and BartWorks Werkstoff are unrelated types — so a
            // Method resolved on one cannot invoke on another (that dropped ~34 veins
            // with an IllegalArgumentException). Resolve + cache the handle per class.
            Map<Class<?>, Method> rgbaByClass = new LinkedHashMap<>();

            // The ore overlay lives at OrePrefixes.ore's texture index within each
            // material's TextureSet (mIconSet). The index field is private in this
            // build (getField("mTextureIndex") threw NoSuchFieldException), so read it
            // via the public getTextureIndex() getter, falling back to the private
            // `textureIndex` field. -1 disables sprite extraction (veins still get
            // name + rgb).
            int oreTextureIndex = -1;
            try {
                Class<?> prefixesC = Class.forName("gregtech.api.enums.OrePrefixes");
                Object orePrefix = prefixesC.getField("ore").get(null);
                Number idx;
                try {
                    idx = (Number) orePrefix.getClass().getMethod("getTextureIndex").invoke(orePrefix);
                } catch (NoSuchMethodException nsm) {
                    Field tf = resolveField(orePrefix.getClass(), "textureIndex", "mTextureIndex");
                    idx = (Number) tf.get(orePrefix);
                }
                oreTextureIndex = idx.intValue();
                System.out.println("[AtlasDumper] ore texture index = " + oreTextureIndex);
            } catch (Throwable t) {
                System.err.println("[AtlasDumper] ore texture index unresolved (" + t + ") — sprites skipped.");
            }

            for (Object mix : mixes) {
                try {
                    Object builder = builderField.get(mix);
                    if (builder == null) continue;
                    String oreMixName = String.valueOf(nameF.get(builder)); // VP palette key
                    String name = (locNameM != null)
                        ? String.valueOf(locNameM.invoke(builder)) : oreMixName;
                    Object rep = (repF != null) ? repF.get(builder) : null;

                    int rgb = 0xFFFFFF;
                    String texture = null;
                    if (rep != null) {
                        Class<?> repCls = rep.getClass();
                        Method rgbaM = rgbaByClass.get(repCls);
                        if (rgbaM == null && !rgbaByClass.containsKey(repCls)) {
                            try { rgbaM = repCls.getMethod("getRGBA"); } catch (Throwable ignored) {}
                            rgbaByClass.put(repCls, rgbaM); // cache the miss (null) too
                        }
                        if (rgbaM != null) {
                            Object arr = rgbaM.invoke(rep);
                            if (arr != null && Array.getLength(arr) >= 3) {
                                int r = ((Number) Array.get(arr, 0)).intValue() & 0xFF;
                                int g = ((Number) Array.get(arr, 1)).intValue() & 0xFF;
                                int b = ((Number) Array.get(arr, 2)).intValue() & 0xFF;
                                rgb = (r << 16) | (g << 8) | b;
                            }
                        }
                        texture = extractOreSprite(rep, oreTextureIndex, oreSprites, preColored, spriteStats);
                        if (texture != null) withTexture++;
                    } else {
                        bump(spriteStats, "no_representative", "representative == null for " + oreMixName);
                    }

                    List<String> dims = new ArrayList<>();
                    if (dimsF != null) {
                        Object dimsObj = dimsF.get(builder);
                        if (dimsObj instanceof Collection) {
                            for (Object d : (Collection<?>) dimsObj) dims.add(String.valueOf(d));
                        }
                    }

                    veins.put(oreMixName, new Object[]{name, texture, rgb, dims});
                    count++;
                } catch (Throwable e) {
                    errors++;
                    if (errorSamples.size() < 30) {
                        Throwable c = (e.getCause() != null) ? e.getCause() : e;
                        errorSamples.add("vein → " + c.getClass().getSimpleName()
                            + (c.getMessage() != null ? ": " + c.getMessage().split("\n")[0] : ""));
                    }
                }
            }
        } catch (Throwable e) {
            // Throwable (not Exception): too-early class init throws Errors, and a
            // reflection-name mismatch must be logged, never silently swallowed.
            System.err.println("[AtlasDumper] FATAL: ore-vein dump reflection failed: " + e);
            return;
        }

        File outDir = new File(gameDir, "config/atlas");
        if (!outDir.exists() && !outDir.mkdirs()) {
            System.err.println("[AtlasDumper] Could not create output directory: " + outDir);
            return;
        }
        File outFile = new File(outDir, "ore_vein_dump.json");
        try (FileWriter w = new FileWriter(outFile)) {
            writeOreVeinJson(w, veins, oreSprites, preColored, count, withTexture, errors, errorSamples, spriteStats);
            System.out.printf("[AtlasDumper] Ore-vein dump done — %d veins (%d with sprite, %d unique sprites), %d errors → %s%n",
                count, withTexture, oreSprites.size(), errors, outFile.getAbsolutePath());
        } catch (IOException e) {
            System.err.println("[AtlasDumper] Ore-vein write failed: " + e.getMessage());
        }
    }

    /**
     * The representative material's grayscale ore-overlay PNG (base64), deduped by icon
     * name into {@code sprites}; returns that icon name (the vein's texture key). GT's
     * ore art is grayscale, tinted by the material colour at render — Atlas ships the
     * gray sprite and tints it by the vein rgb.
     *
     * We do NOT read the stitched atlas: a material's overlay lives at a deterministic
     * resource `assets/gregtech/textures/blocks/materialicons/<SET>/ore.png`, and at
     * world-load the atlas sprite's CPU-side pixel arrays (framesTextureData) are gone
     * anyway. Instead we take the ore container's registered icon name (exact path) and
     * read that PNG straight from the mod jar via the classloader — surviving to
     * world-load, independent of stitch state. Reached through IOreMaterial.getTextureSet()
     * so vanilla Materials, Bartworks Werkstoff and GT++ Material all resolve.
     *
     * Throwable-safe but NOT silent: every bail point bumps a distinct counter (logged
     * once) so the dump summary's sprite_steps pinpoints the exact step next run.
     */
    private String extractOreSprite(Object rep, int oreIndex, Map<String, String> sprites,
                                    Set<String> preColored, Map<String, Integer> stats) {
        if (oreIndex < 0) {
            bump(stats, "skip_bad_index", "oreTextureIndex=" + oreIndex);
            return null;
        }
        try {
            // material → TextureSet: IOreMaterial.getTextureSet() (all rep types), else
            // the vanilla Materials-only public field mIconSet.
            Object textureSet;
            try {
                textureSet = rep.getClass().getMethod("getTextureSet").invoke(rep);
            } catch (NoSuchMethodException nsm) {
                textureSet = rep.getClass().getField("mIconSet").get(rep);
            }
            if (textureSet == null) {
                bump(stats, "no_texture_set", rep.getClass().getName());
                return null;
            }

            // Preferred: the ore container's own registered icon name (exact resource path,
            // handles the CUSTOM/<name> tier). getIcon() is non-null post-stitch.
            String iconName = null;
            try {
                Object arr = textureSet.getClass().getField("mTextures").get(textureSet); // IIconContainer[]
                if (arr != null && oreIndex < Array.getLength(arr)) {
                    Object container = Array.get(arr, oreIndex);
                    if (container != null) {
                        Object iicon = container.getClass().getMethod("getIcon").invoke(container);
                        if (iicon != null) {
                            Object nm = getIconNameMethod.invoke(iicon);
                            if (nm != null) iconName = String.valueOf(nm);
                        }
                    }
                }
            } catch (Throwable ignore) {
                // fall through to the mSetName template below
            }

            // Fallback: derive from the TextureSet's set name (mSetName already carries the
            // full sub-path, e.g. "METALLIC" or "CUSTOM/gold").
            if (iconName == null) {
                Object setNm = textureSet.getClass().getField("mSetName").get(textureSet);
                if (setNm != null) iconName = "gregtech:materialicons/" + setNm + "/ore";
            }
            if (iconName == null) {
                bump(stats, "no_icon_name", textureSet.getClass().getName());
                return null;
            }

            if (!sprites.containsKey(iconName)) {
                // Prefer the base ore.png (grayscale, tinted by rgb at render). When it's
                // fully transparent — some materials (gold/iron/copper/diamond) carry
                // their ore art in a pre-coloured overlay instead — use ore_OVERLAY.png
                // and mark it pre-coloured so the map draws it as-is (no tint).
                byte[] base = readSpriteBytes(iconName);
                byte[] chosen = null;
                boolean precolored = false;
                if (base != null && base.length > 0 && !pngAllTransparent(base)) {
                    chosen = base;
                } else {
                    byte[] overlay = readSpriteBytes(iconName + "_OVERLAY");
                    if (overlay != null && overlay.length > 0 && !pngAllTransparent(overlay)) {
                        chosen = overlay;
                        precolored = true;
                    }
                }
                if (chosen == null) {
                    bump(stats, base == null ? "png_not_found" : "png_blank", iconName);
                    return null; // no usable sprite → vein falls back to a flat rgb dot
                }
                sprites.put(iconName, Base64.getEncoder().encodeToString(chosen));
                if (precolored) {
                    preColored.add(iconName);
                    bump(stats, "precolored", iconName);
                }
            }
            bump(stats, "ok", iconName);
            return iconName;
        } catch (Throwable t) {
            Throwable c = (t.getCause() != null) ? t.getCause() : t;
            bump(stats, "chain_error", c.getClass().getSimpleName()
                + (c.getMessage() != null ? ": " + c.getMessage().split("\n")[0] : "")
                + " (rep=" + rep.getClass().getName() + ")");
            return null;
        }
    }

    /**
     * The mod-jar bytes for an ore sprite icon name ("namespace:path", e.g.
     * "gregtech:materialicons/METALLIC/ore" or the same with an "_OVERLAY" suffix),
     * read straight from the classpath. The source file is
     * {@code assets/<ns>/textures/blocks/<path>.png}. Null if the resource is absent.
     */
    private static byte[] readSpriteBytes(String iconName) {
        String ns, path;
        int colon = iconName.indexOf(':');
        if (colon >= 0) { ns = iconName.substring(0, colon); path = iconName.substring(colon + 1); }
        else { ns = "gregtech"; path = iconName; }
        return readClasspathResource("assets/" + ns + "/textures/blocks/" + path + ".png");
    }

    /** True if the PNG decodes to a fully transparent image (no opaque pixel). */
    private static boolean pngAllTransparent(byte[] bytes) {
        try {
            BufferedImage img = ImageIO.read(new ByteArrayInputStream(bytes));
            if (img == null || !img.getColorModel().hasAlpha()) return false;
            int w = img.getWidth(), h = img.getHeight();
            for (int y = 0; y < h; y++) {
                for (int x = 0; x < w; x++) {
                    if ((img.getRGB(x, y) >>> 24) != 0) return false;
                }
            }
            return true;
        } catch (Throwable t) {
            return false; // undecodable → treat as non-blank (use it as-is)
        }
    }

    /** Read a classpath resource (mod-jar asset) as bytes, trying several classloaders. */
    private static byte[] readClasspathResource(String path) {
        ClassLoader[] loaders = {
            AtlasDumper.class.getClassLoader(),
            Thread.currentThread().getContextClassLoader(),
            ClassLoader.getSystemClassLoader(),
        };
        for (ClassLoader cl : loaders) {
            if (cl == null) continue;
            try (InputStream in = cl.getResourceAsStream(path)) {
                if (in == null) continue;
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) >= 0) bos.write(buf, 0, n);
                return bos.toByteArray();
            } catch (Throwable ignored) {}
        }
        return null;
    }

    /** Increment a named ore-sprite step counter; log the reason on the FIRST hit only. */
    private static void bump(Map<String, Integer> stats, String key, String detail) {
        Integer n = stats.get(key);
        if (n == null) {
            stats.put(key, 1);
            System.out.println("[AtlasDumper]   ore-sprite '" + key + "' first hit: " + detail);
        } else {
            stats.put(key, n + 1);
        }
    }

    @SuppressWarnings("unchecked")
    private void writeOreVeinJson(FileWriter w, Map<String, Object[]> veins,
                                  Map<String, String> sprites, Set<String> preColored,
                                  int count, int withTexture, int errors,
                                  List<String> errorSamples,
                                  Map<String, Integer> spriteStats) throws IOException {
        String ts = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new Date());

        List<String> modList = new ArrayList<>();
        try {
            for (ModContainer mc : Loader.instance().getActiveModList()) {
                modList.add(mc.getModId() + "@" + mc.getVersion());
            }
        } catch (Throwable ignored) {}

        w.write("{\n");
        w.write("  \"format\": \"atlas-gtnh-orevein-dump-v2\",\n");
        w.write("  \"minecraft_version\": \"1.7.10\",\n");
        w.write("  \"generated_at\": " + jsonStr(ts) + ",\n");
        w.write("  \"summary\": { \"vein_count\": " + count + ", \"with_texture\": " + withTexture
            + ", \"errors\": " + errors + ", \"sprite_steps\": {");
        int ssi = 0;
        for (Map.Entry<String, Integer> s : spriteStats.entrySet()) {
            if (ssi++ > 0) w.write(", ");
            w.write(jsonStr(s.getKey()) + ": " + s.getValue());
        }
        w.write("}, \"error_samples\": [");
        for (int i = 0; i < errorSamples.size(); i++) {
            if (i > 0) w.write(", ");
            w.write(jsonStr(errorSamples.get(i)));
        }
        w.write("] },\n");
        w.write("  \"mods\": [");
        for (int i = 0; i < modList.size(); i++) {
            if (i > 0) w.write(", ");
            w.write(jsonStr(modList.get(i)));
        }
        w.write("],\n");
        w.write("  \"veins\": {\n");
        int vi = 0;
        for (Map.Entry<String, Object[]> e : veins.entrySet()) {
            if (vi++ > 0) w.write(",\n");
            Object[] v = e.getValue();
            String name = (String) v[0];
            String texture = (String) v[1];
            int rgb = (Integer) v[2];
            List<String> dims = (List<String>) v[3];
            StringBuilder dimsJson = new StringBuilder("[");
            for (int d = 0; d < dims.size(); d++) {
                if (d > 0) dimsJson.append(", ");
                dimsJson.append(jsonStr(dims.get(d)));
            }
            dimsJson.append("]");
            w.write("    " + jsonStr(e.getKey()) + ": { "
                + "\"name\": " + jsonStr(name) + ", "
                + "\"texture\": " + (texture == null ? "null" : jsonStr(texture)) + ", "
                + "\"rgb\": " + rgb + ", "
                + "\"dims\": " + dimsJson.toString() + " }");
        }
        w.write("\n  },\n");
        // Deduped ore-overlay sprites (base64 PNG), keyed by the icon name each vein's
        // "texture" points at. Grayscale sprites are tinted by the vein rgb at render;
        // the pre-coloured subset (listed in "sprites_precolored") is drawn as-is.
        w.write("  \"sprites\": {\n");
        int si = 0;
        for (Map.Entry<String, String> s : sprites.entrySet()) {
            if (si++ > 0) w.write(",\n");
            w.write("    " + jsonStr(s.getKey()) + ": " + jsonStr(s.getValue()));
        }
        w.write("\n  },\n");
        w.write("  \"sprites_precolored\": [");
        int pi = 0;
        for (String k : preColored) {
            if (pi++ > 0) w.write(", ");
            w.write(jsonStr(k));
        }
        w.write("]\n}\n");
    }

    // ── Reflection helpers (MCP name → SRG name fallback) ──────────────────────

    private static Method resolveMethod(Class<?> c, Class<?>[] params, String... names) throws NoSuchMethodException {
        for (String n : names) {
            try { return c.getMethod(n, params); } catch (NoSuchMethodException ignored) {}
        }
        throw new NoSuchMethodException(names[0] + " (+ SRG) not found on " + c.getName());
    }

    private static Field resolveField(Class<?> c, String... names) throws NoSuchFieldException {
        for (String n : names) {
            try { return c.getField(n); } catch (NoSuchFieldException ignored) {}
        }
        for (String n : names) {
            try { Field f = c.getDeclaredField(n); f.setAccessible(true); return f; }
            catch (NoSuchFieldException ignored) {}
        }
        throw new NoSuchFieldException(names[0] + " (+ SRG) not found on " + c.getName());
    }

    private static Field resolveFieldOrNull(Class<?> c, String... names) {
        try { return resolveField(c, names); } catch (NoSuchFieldException e) { return null; }
    }

    /** First no-arg method matching one of {@code names} (public), or null if none. */
    private static Method resolveMethodOrNull(Class<?> c, String... names) {
        for (String n : names) {
            try { return c.getMethod(n); } catch (NoSuchMethodException ignored) {}
        }
        return null;
    }

    private static String jsonStr(String s) {
        if (s == null) return "null";
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if      (c == '"')  sb.append("\\\"");
            else if (c == '\\') sb.append("\\\\");
            else if (c == '\n') sb.append("\\n");
            else if (c == '\r') sb.append("\\r");
            else if (c == '\t') sb.append("\\t");
            else                sb.append(c);
        }
        return sb.append('"').toString();
    }

    // ── Rotation dump ────────────────────────────────────────────────────
    // Which NBT keys each tile entity actually writes.
    //
    // Atlas has to re-face machines when it rotates a pasted selection, and
    // facing lives in tile-entity NBT under a name each mod picks for itself
    // (GregTech uses mFacing, others use facing/direction/orientation...).
    // Without this list the rotator can only pattern-match key names and hope,
    // which is a guess written into somebody's save.
    //
    // Read the same way the icon dump reads icons — by asking the game rather
    // than by inferring from ids. Each tile entity is constructed and asked to
    // serialise itself; the keys it emits are its real storage schema.
    //
    // Nothing is placed or modified in the world: instances are standalone and
    // discarded. Classes that refuse to construct or serialise in isolation are
    // recorded as failures rather than skipped silently, since a missing entry
    // and an unrotatable machine look identical from the Python side.
    @SuppressWarnings({"unchecked", "rawtypes"})
    private void dumpRotations() {
        Map<String, String[]> teKeys = new TreeMap<String, String[]>();
        List<String> failed = new ArrayList<String>();

        try {
            Class<?> teClass = Class.forName("net.minecraft.tileentity.TileEntity");
            Map<String, Class<?>> byName = null;
            // Forge 1.7.10 keeps the registry in a private static map; the field
            // name differs between obfuscated and MCP-mapped runs.
            for (Field f : teClass.getDeclaredFields()) {
                if (!Map.class.isAssignableFrom(f.getType())) continue;
                f.setAccessible(true);
                Map<?, ?> m = (Map<?, ?>) f.get(null);
                if (m == null || m.isEmpty()) continue;
                Object k = m.keySet().iterator().next();
                if (k instanceof String) { byName = (Map<String, Class<?>>) m; break; }
            }
            if (byName == null) {
                System.err.println("[AtlasDumper] Could not find the tile-entity registry; skipping rotation dump.");
                return;
            }

            Class<?> nbtClass = Class.forName("net.minecraft.nbt.NBTTagCompound");
            // Resolved from the first tile entity that will actually construct.
            // It cannot be probed on TileEntity itself: that class is abstract,
            // so newInstance() always throws and the probe never succeeds.
            String writerName = null;

            for (Map.Entry<String, Class<?>> e : byName.entrySet()) {
                Object inst;
                try {
                    inst = e.getValue().newInstance();
                } catch (Throwable t) {
                    failed.add(e.getKey() + ": " + t.getClass().getSimpleName());
                    continue;
                }
                try {
                    if (writerName == null) writerName = findWriter(inst, nbtClass);
                    if (writerName == null) {
                        failed.add(e.getKey() + ": no writer found");
                        continue;
                    }
                    Method w = inst.getClass().getMethod(writerName, nbtClass);
                    Object tag = nbtClass.newInstance();
                    w.invoke(inst, tag);
                    Set<String> keys = keysOf(tag);
                    teKeys.put(e.getKey(), keys.toArray(new String[keys.size()]));
                } catch (Throwable t) {
                    failed.add(e.getKey() + ": " + t.getClass().getSimpleName());
                }
            }
        } catch (Throwable t) {
            System.err.println("[AtlasDumper] Rotation dump failed: " + t);
            return;
        }

        File outDir = new File(gameDir, "config/atlas");
        if (!outDir.exists() && !outDir.mkdirs()) {
            System.err.println("[AtlasDumper] Could not create output directory: " + outDir);
            return;
        }
        File outFile = new File(outDir, "rotation_dump.json");
        try (FileWriter w = new FileWriter(outFile)) {
            String ts = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'").format(new Date());
            w.write("{\n");
            w.write("  \"format\": \"atlas-gtnh-rotation-dump-v1\",\n");
            w.write("  \"dumper_version\": " + jsonStr(VERSION) + ",\n");
            w.write("  \"generated_at\": " + jsonStr(ts) + ",\n");
            w.write("  \"tile_entity_keys\": {\n");
            int i = 0;
            for (Map.Entry<String, String[]> e : teKeys.entrySet()) {
                w.write("    " + jsonStr(e.getKey()) + ": [");
                for (int k = 0; k < e.getValue().length; k++) {
                    if (k > 0) w.write(", ");
                    w.write(jsonStr(e.getValue()[k]));
                }
                w.write("]");
                w.write(++i < teKeys.size() ? ",\n" : "\n");
            }
            w.write("  },\n");
            w.write("  \"failed\": [");
            for (int k = 0; k < failed.size(); k++) {
                if (k > 0) w.write(", ");
                w.write(jsonStr(failed.get(k)));
            }
            w.write("]\n}\n");
            System.out.println("[AtlasDumper] Wrote " + teKeys.size() + " tile-entity schemas ("
                    + failed.size() + " failed) to " + outFile);
        } catch (IOException e) {
            System.err.println("[AtlasDumper] Could not write rotation dump: " + e);
        }
    }

    /**
     * Name of the (NBTTagCompound) -> void method that leaves keys behind.
     *
     * writeToNBT and readFromNBT have identical signatures and the name is
     * obfuscated in a production run, so the writer is identified by what it
     * does rather than what it is called. Probed on a real tile entity: doing it
     * on TileEntity itself is impossible, the class being abstract.
     */
    private static String findWriter(Object te, Class<?> nbtClass) {
        for (Method m : te.getClass().getMethods()) {
            if (m.getParameterTypes().length != 1) continue;
            if (m.getParameterTypes()[0] != nbtClass) continue;
            if (m.getReturnType() != void.class) continue;
            try {
                Object tag = nbtClass.newInstance();
                m.invoke(te, tag);
                if (!keysOf(tag).isEmpty()) return m.getName();
            } catch (Throwable ignored) { /* the reader, or it needs a world */ }
        }
        return null;
    }

    /** Key names of an NBTTagCompound, via whichever accessor this build exposes. */
    @SuppressWarnings("unchecked")
    private static Set<String> keysOf(Object tag) {
        for (Method m : tag.getClass().getMethods()) {
            if (m.getParameterTypes().length == 0 && Set.class.isAssignableFrom(m.getReturnType())) {
                try {
                    Set<String> s = (Set<String>) m.invoke(tag);
                    if (s != null) return s;
                } catch (Throwable ignored) { /* next */ }
            }
        }
        return Collections.emptySet();
    }

}
