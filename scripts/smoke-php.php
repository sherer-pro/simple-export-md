<?php
// Isolated WordPress API stubs: no database, plugin activation or real admin state.
define( 'ABSPATH', __DIR__ );
define( 'SCRIPT_DEBUG', isset( $argv[1] ) && 'debug' === $argv[1] );
$test_admin = true;
$test_can_edit = true;
$test_screen = null;
$test_assets = array();
function add_action( $hook, $callback ) {}
function get_bloginfo( $key ) { return '6.0'; }
function is_admin() { global $test_admin; return $test_admin; }
function current_user_can( $cap ) { global $test_can_edit; return $test_can_edit; }
function get_current_screen() { global $test_screen; return $test_screen; }
function plugin_dir_path( $file ) { return dirname( $file ) . '/'; }
function plugin_dir_url( $file ) { return 'https://example.invalid/plugin/'; }
function wp_enqueue_script( $handle, $src, $deps, $version, $footer ) { global $test_assets; $test_assets[] = $src; }
function wp_enqueue_style( $handle, $src, $deps, $version ) { global $test_assets; $test_assets[] = $src; }
function wp_set_script_translations( $handle, $domain, $path ) {}
function test_screen( $base, $block_editor = true ) {
    return new class( $base, $block_editor ) {
        public $base;
        private $block_editor;
        public function __construct( $base, $block_editor ) { $this->base = $base; $this->block_editor = $block_editor; }
        public function is_block_editor() { return $this->block_editor; }
    };
}
function verify( $condition, $message ) { if ( ! $condition ) { throw new RuntimeException( $message ); } }
require dirname( __DIR__ ) . '/simple-export-md.php';
foreach ( array( null, test_screen( 'widgets' ), test_screen( 'site-editor' ), test_screen( 'post', false ) ) as $test_screen ) {
    $test_assets = array();
    sherer_export_md_enqueue_block_editor_assets();
    verify( ! $test_assets, 'Do not enqueue outside the post block editor' );
}
$test_screen = test_screen( 'post' );
foreach ( array( array( false, true ), array( true, false ), array( true, true ) ) as $context ) {
    list( $test_admin, $test_can_edit ) = $context;
    $test_assets = array();
    sherer_export_md_enqueue_block_editor_assets();
    verify( count( $test_assets ) === ( $test_admin && $test_can_edit ? 3 : 0 ), 'Enforce editor context and capability' );
}
$suffix = SCRIPT_DEBUG ? '.js' : '.min.js';
verify( substr( $test_assets[1], -strlen( 'export-md' . $suffix ) ) === 'export-md' . $suffix, 'Select the correct script variant' );
$source = file_get_contents( dirname( __DIR__ ) . '/simple-export-md.php' );
verify( strpos( $source, 'Requires at least: ' . SHERER_EXPORT_MD_MIN_WP ) !== false, 'WordPress header matches runtime requirement' );
verify( strpos( $source, 'Requires PHP: ' . SHERER_EXPORT_MD_MIN_PHP ) !== false, 'PHP header matches runtime requirement' );
echo 'PHP editor asset smoke passed (' . ( SCRIPT_DEBUG ? 'debug' : 'production' ) . ')', PHP_EOL;
