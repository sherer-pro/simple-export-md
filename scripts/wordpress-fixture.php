<?php
// Only for a disposable, isolated WordPress installation.
if ( 'cli' !== PHP_SAPI || '1' !== getenv( 'SIMPLE_EXPORT_MD_AUDIT' ) ) {
    echo "Only CLI in a disposable SIMPLE_EXPORT_MD_AUDIT container is supported.\n";
    exit( 1 );
}
define( 'WP_INSTALLING', true );
$test_url = isset( $argv[1] ) ? $argv[1] : '';
$test_host = parse_url( $test_url, PHP_URL_HOST );
if ( ! in_array( $test_host, array( '127.0.0.1', 'localhost' ), true ) ) {
    throw new RuntimeException( 'A disposable localhost URL is required.' );
}
$_SERVER['HTTP_HOST'] = $test_host . ':' . parse_url( $test_url, PHP_URL_PORT );
$_SERVER['REQUEST_URI'] = '/';
require '/var/www/html/wp-load.php';
require_once ABSPATH . 'wp-admin/includes/upgrade.php';
require_once ABSPATH . 'wp-admin/includes/plugin.php';
if ( ! is_blog_installed() ) {
    wp_install( 'Markdown audit', 'audit-admin', 'audit@example.invalid', true, '', wp_generate_password() );
}
update_option( 'siteurl', $test_url );
update_option( 'home', $test_url );
$activation = activate_plugin( 'simple-export-md/simple-export-md.php' );
if ( is_wp_error( $activation ) ) { throw new RuntimeException( $activation->get_error_message() ); }
$categories = array();
for ( $index = 1; $index <= 201; $index++ ) {
    $name = 'Audit category ' . $index;
    $term = term_exists( $name, 'category' );
    if ( ! $term ) { $term = wp_insert_term( $name, 'category' ); }
    if ( is_wp_error( $term ) ) { throw new RuntimeException( $term->get_error_message() ); }
    $categories[] = (int) $term['term_id'];
}
$post = wp_insert_post( array(
    'post_title' => 'Audit post', 'post_status' => 'draft',
    'post_content' => '<!-- wp:paragraph --><p>Saved body</p><!-- /wp:paragraph -->',
) );
update_option( 'simple_export_md_audit_fixture', array( 'post' => $post, 'categories' => $categories ) );
$mu_dir = WP_CONTENT_DIR . '/mu-plugins';
wp_mkdir_p( $mu_dir );
file_put_contents( $mu_dir . '/simple-export-md-audit.php', <<<'PHP'
<?php
if ( '1' !== getenv( 'SIMPLE_EXPORT_MD_AUDIT' ) ) { return; }
add_action( 'init', function () {
    if ( isset( $_GET['semd-audit'] ) ) {
        $user = get_user_by( 'login', 'audit-admin' );
        wp_set_current_user( $user->ID );
        wp_set_auth_cookie( $user->ID );
    }
} );
add_action( 'admin_enqueue_scripts', function () {
    wp_add_inline_script( 'wp-data', 'window.simpleExportMdAuditFixture = ' . wp_json_encode( get_option( 'simple_export_md_audit_fixture' ) ) . ';' );
    wp_add_inline_script( 'wp-blocks', <<<'JS'
window.simpleExportMdFixtureCalls = 0;
wp.blocks.registerBlockType('example/export-diagram', {
    apiVersion: 2, title: 'Fixture diagram', category: 'widgets',
    attributes: { caption: { type: 'string', default: '' } },
    edit: function () { return wp.element.createElement('p', {}, 'Fixture diagram'); },
    save: function () { return null; }
});
wp.hooks.addFilter('simple_export_md.exporters', 'example/fixture', function (entries) {
    return entries.concat([{
        id: 'example/fixture', label: 'Fixture diagrams', blockNames: ['example/export-diagram'], selector: '.fixture-export-html',
        formats: [{ value: 'svg', label: 'Inline SVG' }, { value: 'image', label: 'Image URL' }],
        exportBlock: async function (block, context) {
            window.simpleExportMdFixtureCalls++;
            await new Promise(function (resolve) { setTimeout(resolve, 30); });
            if (context.format === 'svg') return { type: 'svg', content: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 40"><rect width="80" height="40" fill="blue"/><text x="2" y="20">Fixture SVG</text></svg>' };
            return { type: 'image', url: 'https://example.invalid/diagram.png', alt: 'Fixture diagram' };
        },
        exportHtml: function () { return { type: 'html', content: '<p><strong>Fixture HTML exported</strong></p>' }; }
    }]);
});
JS
    );
} );
PHP
);
echo wp_json_encode( array( 'wordpress' => get_bloginfo( 'version' ), 'php' => PHP_VERSION, 'post' => $post, 'categories' => count( $categories ) ) ), PHP_EOL;
