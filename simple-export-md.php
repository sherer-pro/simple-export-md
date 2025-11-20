<?php
/**
 * Plugin Name: Simple Export to Markdown
 * Plugin URI: https://github.com/sherer-pro/simple-export-md
 * Description: Adds a Gutenberg panel “Export to Markdown” with buttons to download .md or copy Markdown to clipboard.
 * Version:     0.1.1
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

/**
 * Requirements check: PHP >= 7.4, WordPress >= 6.0.
 * If requirements are not met, show admin notice and deactivate the plugin.
 */
function sherer_export_md_requirements_check() {

    $php_required = '7.4';
    $wp_required  = '6.0';

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
 * Enqueue editor assets (Turndown + main script).
 */
function sherer_export_md_enqueue_block_editor_assets() {
    if ( ! is_admin() ) {
        return;
    }

    $asset_dir = plugin_dir_path( __FILE__ ) . 'assets/';

    // Use minified Turndown if present, fallback to non-minified.
    $turndown_file = file_exists( $asset_dir . 'turndown.min.js' ) ? 'turndown.min.js' : 'turndown.js';

    wp_enqueue_script(
        'sherer-export-md-turndown',
        plugins_url( 'assets/' . $turndown_file, __FILE__ ),
        array(),
        file_exists( $asset_dir . $turndown_file ) ? filemtime( $asset_dir . $turndown_file ) : '7.1.2',
        true
    );

    // Use minified main script by default, switch to non-minified when SCRIPT_DEBUG is true.
    $debug       = defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG;
    $script_file = $debug ? 'export-md.js' : 'export-md.min.js';
    $script_path = $asset_dir . $script_file;

    wp_enqueue_script(
        'sherer-export-md',
        plugins_url( 'assets/' . $script_file, __FILE__ ),
        array(
            'wp-plugins',
            'wp-edit-post',
            'wp-element',
            'wp-components',
            'wp-data',
            'wp-i18n',
            'wp-blocks',
        ),
        file_exists( $script_path ) ? filemtime( $script_path ) : '0.4.0',
        true
    );

    // JS translations (JSON files in /languages).
    wp_set_script_translations(
        'sherer-export-md',
        'simple-export-md',
        plugin_dir_path( __FILE__ ) . 'languages'
    );
}
add_action( 'enqueue_block_editor_assets', 'sherer_export_md_enqueue_block_editor_assets' );