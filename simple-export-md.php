<?php
/**
 * Plugin Name: Simple Export to Markdown
 * Plugin URI: https://github.com/sherer-pro/simple-export-md
 * Description: Adds a Gutenberg panel “Export to Markdown” with buttons to download .md or copy Markdown to clipboard.
 * Version:     0.1.3
 * Author:      Pavel Sherer
 * Author URI:  https://sherer.pro
 * License:     GPL-2.0-or-later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: simple-export-md
 * Domain Path: /languages
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

define( 'SHERER_EXPORT_MD_VERSION', '0.1.3' );
define( 'SHERER_EXPORT_MD_MIN_PHP', '7.4' );
define( 'SHERER_EXPORT_MD_MIN_WP', '6.0' );
define( 'SHERER_EXPORT_MD_TEXT_DOMAIN', 'simple-export-md' );
define( 'SHERER_EXPORT_MD_SCRIPT_HANDLE', 'simple-export-md' );
define( 'SHERER_EXPORT_MD_TURNDOWN_HANDLE', 'simple-export-md-turndown' );
define( 'SHERER_EXPORT_MD_STYLE_HANDLE', 'simple-export-md-editor' );

/**
 * Requirements check: PHP >= 7.4, WordPress >= 6.0.
 * If requirements are not met, show admin notice and deactivate the plugin.
 */
function sherer_export_md_requirements_check() {

    $php_required = SHERER_EXPORT_MD_MIN_PHP;
    $wp_required  = SHERER_EXPORT_MD_MIN_WP;

    $php_ok = version_compare( PHP_VERSION, $php_required, '>=' );
    $wp_ok  = version_compare( get_bloginfo( 'version' ), $wp_required, '>=' );

    if ( $php_ok && $wp_ok ) {
        return true;
    }

    $message  = '<strong>Simple Export to Markdown</strong> cannot run.';
    $message .= '<br>Minimum requirements: PHP ' . esc_html( $php_required ) . ' and WordPress ' . esc_html( $wp_required ) . '.';
    $message .= '<br>Your system: PHP ' . esc_html( PHP_VERSION ) . ', WordPress ' . esc_html( get_bloginfo( 'version' ) ) . '.';

    add_action(
        'admin_notices',
        function () use ( $message ) {
            $allowed = array(
                'strong' => array(),
                'br'     => array(),
            );
            echo '<div class="notice notice-error"><p>' . wp_kses( $message, $allowed ) . '</p></div>';

        }
    );

    add_action(
        'admin_init',
        function () {
            deactivate_plugins( plugin_basename( __FILE__ ) );
        }
    );

    return false;
}

// Stop loading the plugin if requirements are not met.
if ( ! sherer_export_md_requirements_check() ) {
    return;
}

/**
 * Get an asset version based on the file modification time.
 *
 * @param string $path Absolute path to the asset.
 * @return string
 */
function sherer_export_md_asset_version( $path ) {
    return file_exists( $path ) ? (string) filemtime( $path ) : SHERER_EXPORT_MD_VERSION;
}

/**
 * Enqueue editor assets (Turndown + main script).
 */
function sherer_export_md_enqueue_block_editor_assets() {
    if ( ! is_admin() || ! current_user_can( 'edit_posts' ) ) {
        return;
    }

    $asset_dir = plugin_dir_path( __FILE__ ) . 'assets/';
    $asset_url = plugin_dir_url( __FILE__ ) . 'assets/';
    $debug     = defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG;

    $turndown_file = $debug ? 'turndown.js' : 'turndown.min.js';
    if ( ! file_exists( $asset_dir . $turndown_file ) ) {
        $turndown_file = 'turndown.js';
    }

    wp_enqueue_script(
        SHERER_EXPORT_MD_TURNDOWN_HANDLE,
        $asset_url . $turndown_file,
        array(),
        sherer_export_md_asset_version( $asset_dir . $turndown_file ),
        true
    );

    // Use minified main script by default, switch to non-minified when SCRIPT_DEBUG is true.
    $script_file = $debug ? 'export-md.js' : 'export-md.min.js';
    $script_path = $asset_dir . $script_file;
    if ( ! file_exists( $script_path ) ) {
        $script_file = 'export-md.js';
        $script_path = $asset_dir . $script_file;
    }

    wp_enqueue_script(
        SHERER_EXPORT_MD_SCRIPT_HANDLE,
        $asset_url . $script_file,
        array(
            SHERER_EXPORT_MD_TURNDOWN_HANDLE,
            'wp-plugins',
            'wp-edit-post',
            'wp-element',
            'wp-components',
            'wp-data',
            'wp-i18n',
            'wp-blocks',
            'wp-core-data',
            'wp-block-editor',
        ),
        sherer_export_md_asset_version( $script_path ),
        true
    );

    $style_file = 'export-md.css';
    $style_path = $asset_dir . $style_file;

    wp_enqueue_style(
        SHERER_EXPORT_MD_STYLE_HANDLE,
        $asset_url . $style_file,
        array( 'wp-edit-blocks' ),
        sherer_export_md_asset_version( $style_path )
    );

    // JS translations (JSON files in /languages).
    wp_set_script_translations(
        SHERER_EXPORT_MD_SCRIPT_HANDLE,
        SHERER_EXPORT_MD_TEXT_DOMAIN,
        plugin_dir_path( __FILE__ ) . 'languages'
    );
}
add_action( 'enqueue_block_editor_assets', 'sherer_export_md_enqueue_block_editor_assets' );
