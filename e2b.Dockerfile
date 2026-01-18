# Shadower Custom Sandbox Template
# Pre-installed with all document generation packages for instant PPT, Word, and Excel creation

FROM e2bdev/code-interpreter:latest

# Switch to root for package installation
USER root

# Set working directory
WORKDIR /home/user

# ============================================================================
# Node.js Document Generation Packages
# ============================================================================

# Install pptxgenjs for PowerPoint generation (Gamma-quality presentations)
RUN npm install -g pptxgenjs@4.0.1

# Install docx for Word document generation
RUN npm install -g docx@9.1.1

# Install exceljs for Excel spreadsheet generation
RUN npm install -g exceljs@4.4.0

# Install supporting packages for document editing
RUN npm install -g jszip@3.10.1 @xmldom/xmldom@0.9.5 mammoth@1.8.0

# Make packages available globally in Node.js
ENV NODE_PATH=/usr/local/lib/node_modules

# ============================================================================
# Python Document Generation Packages (Alternative/Fallback)
# ============================================================================

# Install python-pptx for PowerPoint generation
RUN pip install python-pptx==1.0.2

# Install python-docx for Word document generation  
RUN pip install python-docx==1.1.2

# Install openpyxl for Excel spreadsheet generation
RUN pip install openpyxl==3.1.5

# Install xlsxwriter for advanced Excel features
RUN pip install XlsxWriter==3.2.0

# Install additional data processing libraries
RUN pip install pandas numpy matplotlib seaborn plotly

# ============================================================================
# PDF Generation
# ============================================================================

# Install reportlab for PDF generation
RUN pip install reportlab==4.2.5

# Install WeasyPrint for HTML to PDF
RUN pip install weasyprint==63.1

# ============================================================================
# Image Processing (for documents with images)
# ============================================================================

RUN pip install Pillow==11.0.0

# ============================================================================
# Pre-create node_modules in /home/user for local installs
# ============================================================================

RUN mkdir -p /home/user/node_modules && \
    cd /home/user && \
    npm init -y && \
    npm install pptxgenjs docx exceljs jszip @xmldom/xmldom mammoth --save

# Set proper permissions
RUN chmod -R 777 /home/user

# Verify installations
RUN node -e "require('pptxgenjs'); console.log('✓ pptxgenjs installed')"
RUN node -e "require('docx'); console.log('✓ docx installed')"
RUN node -e "require('exceljs'); console.log('✓ exceljs installed')"
RUN python -c "from pptx import Presentation; print('✓ python-pptx installed')"
RUN python -c "from docx import Document; print('✓ python-docx installed')"
RUN python -c "from openpyxl import Workbook; print('✓ openpyxl installed')"

WORKDIR /home/user
